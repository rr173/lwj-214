import prisma from '../prisma';
import { isTimeOverlap, getOverlapTimeRange } from '../utils/time';
import {
  validateDate, validateTimeRange, validateAttendeeCount,
  validateBookerName, validateTopic, validateCancelReason,
  ValidationError
} from '../utils/validation';
import { getRoomByNumber } from './roomService';
import { processWaitlistForSlot, processWaitlistForRoom } from './waitlistService';
import { invalidateVisitorsByBookingId } from './visitorService';
import { calculateCost, calculateRefund, createBillingRecord, CostBreakdown } from './billingService';
import { getDepartmentByName, hasEnoughBalance, getMonthKey } from './budgetService';
import type { MeetingRoom, Booking } from '@prisma/client';

export interface CreateBookingInput {
  bookerName: string;
  departmentName: string;
  roomNumber: string;
  date: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  topic: string;
}

export interface UpdateBookingInput {
  roomNumber?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  attendeeCount?: number;
  topic?: string;
}

export interface ConflictInfo {
  existingBooking: Booking;
  overlapStart: string;
  overlapEnd: string;
}

export async function checkRoomConflicts(
  roomId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string
): Promise<ConflictInfo[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      roomId,
      date,
      isCancelled: false,
      isReleased: false,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {})
    }
  });

  const conflicts: ConflictInfo[] = [];
  for (const booking of bookings) {
    if (isTimeOverlap(startTime, endTime, booking.startTime, booking.endTime)) {
      const overlap = getOverlapTimeRange(startTime, endTime, booking.startTime, booking.endTime);
      if (overlap) {
        conflicts.push({
          existingBooking: booking,
          overlapStart: overlap.start,
          overlapEnd: overlap.end
        });
      }
    }
  }
  return conflicts;
}

export async function checkUserConflicts(
  bookerName: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string
): Promise<ConflictInfo[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      bookerName,
      date,
      isCancelled: false,
      isReleased: false,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {})
    }
  });

  const conflicts: ConflictInfo[] = [];
  for (const booking of bookings) {
    if (isTimeOverlap(startTime, endTime, booking.startTime, booking.endTime)) {
      const overlap = getOverlapTimeRange(startTime, endTime, booking.startTime, booking.endTime);
      if (overlap) {
        conflicts.push({
          existingBooking: booking,
          overlapStart: overlap.start,
          overlapEnd: overlap.end
        });
      }
    }
  }
  return conflicts;
}

export async function createBooking(input: CreateBookingInput) {
  const errors: ValidationError[] = [];

  const bookerNameErr = validateBookerName(input.bookerName);
  if (bookerNameErr) errors.push(bookerNameErr);

  if (!input.departmentName || typeof input.departmentName !== 'string') {
    errors.push({ field: 'departmentName', message: '所属部门不能为空' });
  }

  const topicErr = validateTopic(input.topic);
  if (topicErr) errors.push(topicErr);

  const dateErr = validateDate(input.date);
  if (dateErr) errors.push(dateErr);

  const timeErrors = validateTimeRange(input.startTime, input.endTime, input.date);
  errors.push(...timeErrors);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const department = await getDepartmentByName(input.departmentName);
  if (!department) {
    return {
      success: false,
      errors: [{ field: 'departmentName', message: `部门 ${input.departmentName} 不存在` }]
    };
  }

  const room = await getRoomByNumber(input.roomNumber);
  if (!room) {
    return {
      success: false,
      errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 不存在` }]
    };
  }

  if (!room.isActive) {
    return {
      success: false,
      errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 已停用，无法预约` }]
    };
  }

  const attendeeErr = validateAttendeeCount(input.attendeeCount, room.capacity);
  if (attendeeErr) {
    return { success: false, errors: [attendeeErr] };
  }

  const costBreakdown = calculateCost(input.startTime, input.endTime, room.capacity);

  const monthKey = getMonthKey(input.date);
  const enough = await hasEnoughBalance(department.id, costBreakdown.totalCost, monthKey);
  if (!enough) {
    return {
      success: false,
      errors: [{ field: 'departmentName', message: `部门月度预算不足，当月余额不足${costBreakdown.totalCost}元` }]
    };
  }

  const roomConflicts = await checkRoomConflicts(room.id, input.date, input.startTime, input.endTime);
  if (roomConflicts.length > 0) {
    const conflictDescs = roomConflicts.map(c =>
      `与预约"${c.existingBooking.topic}"(${c.existingBooking.bookerName})在 ${c.overlapStart}-${c.overlapEnd} 冲突`
    ).join('; ');
    return {
      success: false,
      errors: [{ field: 'timeRange', message: `时间段冲突: ${conflictDescs}` }]
    };
  }

  const userConflicts = await checkUserConflicts(input.bookerName, input.date, input.startTime, input.endTime);
  if (userConflicts.length > 0) {
    const conflictDescs = userConflicts.map(c =>
      `您已预约"${c.existingBooking.topic}"(${c.existingBooking.roomNumber})在 ${c.overlapStart}-${c.overlapEnd}`
    ).join('; ');
    return {
      success: false,
      errors: [{ field: 'timeRange', message: `同一时段已有预约: ${conflictDescs}` }]
    };
  }

  const booking = await prisma.booking.create({
    data: {
      bookerName: input.bookerName,
      departmentId: department.id,
      roomId: room.id,
      roomNumber: input.roomNumber,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      attendeeCount: input.attendeeCount,
      topic: input.topic,
      totalCost: costBreakdown.totalCost,
      refundedAmount: 0
    }
  });

  await createBillingRecord({
    departmentId: department.id,
    bookingId: booking.id,
    roomId: room.id,
    roomNumber: input.roomNumber,
    date: input.date,
    type: 'charge',
    amount: costBreakdown.totalCost,
    peakMinutes: costBreakdown.peakMinutes,
    offPeakMinutes: costBreakdown.offPeakMinutes,
    peakHoursCost: costBreakdown.peakHoursCost,
    offPeakHoursCost: costBreakdown.offPeakHoursCost,
    description: `预约扣费: ${input.topic} (${input.startTime}-${input.endTime})`
  });

  return { success: true, data: { ...booking, costBreakdown } };
}

export async function getBookingById(id: string) {
  return prisma.booking.findUnique({ where: { id }, include: { room: true } });
}

export async function getBookingsByRoomAndDate(roomNumber: string, date: string) {
  return prisma.booking.findMany({
    where: { roomNumber, date },
    orderBy: { startTime: 'asc' }
  });
}

export async function getBookingsByDateRange(startDate: string, endDate: string, includeCancelled: boolean = true) {
  const where: any = {
    date: { gte: startDate, lte: endDate }
  };
  if (!includeCancelled) {
    where.isCancelled = false;
  }
  return prisma.booking.findMany({
    where,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
  });
}

export async function cancelBooking(id: string, cancelReason: string) {
  const reasonErr = validateCancelReason(cancelReason);
  if (reasonErr) {
    return { success: false, errors: [reasonErr] };
  }

  const booking = await getBookingById(id);
  if (!booking) {
    return {
      success: false,
      errors: [{ field: 'id', message: '预约不存在' }]
    };
  }

  if (booking.isCancelled) {
    return {
      success: false,
      errors: [{ field: 'id', message: '该预约已取消' }]
    };
  }

  const cancelTime = new Date();
  let refundAmount = 0;
  if (booking.totalCost && booking.departmentId) {
    refundAmount = calculateRefund(booking.totalCost, booking.date, booking.startTime, cancelTime);
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      isCancelled: true,
      cancelledAt: cancelTime,
      cancelReason,
      refundedAmount: refundAmount
    }
  });

  if (refundAmount > 0 && booking.departmentId) {
    await createBillingRecord({
      departmentId: booking.departmentId,
      bookingId: booking.id,
      roomId: booking.roomId,
      roomNumber: booking.roomNumber,
      date: booking.date,
      type: 'refund',
      amount: -refundAmount,
      description: `取消预约退费: ${booking.topic}，退费${refundAmount}元，原因: ${cancelReason}`
    });
  }

  await prisma.bookingLog.create({
    data: {
      date: booking.date,
      type: 'booking_cancelled',
      bookingId: booking.id,
      description: `预约取消: ${booking.bookerName} 的预约(${booking.roomNumber} ${booking.date} ${booking.startTime}-${booking.endTime})被取消，原因: ${cancelReason}，退费: ${refundAmount}元`
    }
  });

  const invalidatedVisitors = await invalidateVisitorsByBookingId(booking.id, '关联预约已取消');

  const conversions = await processWaitlistForSlot(
    booking.roomId,
    booking.date,
    booking.startTime,
    booking.endTime,
    '预约取消'
  );

  return { success: true, data: { ...updated, refundAmount }, waitlistConversions: conversions, invalidatedVisitors };
}

export async function updateBooking(id: string, input: UpdateBookingInput) {
  const existingBooking = await getBookingById(id);
  if (!existingBooking) {
    return {
      success: false,
      errors: [{ field: 'id', message: '预约不存在' }]
    };
  }

  if (existingBooking.isCancelled) {
    return {
      success: false,
      errors: [{ field: 'id', message: '已取消的预约无法修改' }]
    };
  }

  const errors: ValidationError[] = [];
  const date = input.date || existingBooking.date;
  const startTime = input.startTime || existingBooking.startTime;
  const endTime = input.endTime || existingBooking.endTime;
  const roomNumber = input.roomNumber || existingBooking.roomNumber;

  if (input.topic !== undefined) {
    const err = validateTopic(input.topic);
    if (err) errors.push(err);
  }

  if (input.date !== undefined) {
    const err = validateDate(input.date);
    if (err) errors.push(err);
  }

  if (input.startTime !== undefined || input.endTime !== undefined || input.date !== undefined) {
    const timeErrors = validateTimeRange(startTime, endTime, date);
    errors.push(...timeErrors);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  let room: MeetingRoom | null = existingBooking.room;
  if (input.roomNumber && input.roomNumber !== existingBooking.roomNumber) {
    room = await getRoomByNumber(input.roomNumber);
    if (!room) {
      return {
        success: false,
        errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 不存在` }]
      };
    }
    if (!room.isActive) {
      return {
        success: false,
        errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 已停用，无法预约` }]
      };
    }
  }

  const effectiveAttendeeCount = input.attendeeCount !== undefined ? input.attendeeCount : existingBooking.attendeeCount;
  const attendeeErr = validateAttendeeCount(effectiveAttendeeCount, room.capacity);
  if (attendeeErr) {
    return { success: false, errors: [attendeeErr] };
  }

  const timeOrRoomChanged = !!(input.roomNumber || input.date || input.startTime || input.endTime);

  let newCostBreakdown: CostBreakdown | null = null;
  let costDifference = 0;

  if (timeOrRoomChanged && existingBooking.departmentId) {
    newCostBreakdown = calculateCost(startTime, endTime, room.capacity);
    const oldCost = existingBooking.totalCost || 0;
    const refundedSoFar = existingBooking.refundedAmount || 0;
    const netOldCost = oldCost - refundedSoFar;
    costDifference = Math.round((newCostBreakdown.totalCost - netOldCost) * 100) / 100;

    if (costDifference > 0) {
      const monthKey = getMonthKey(date);
      const enough = await hasEnoughBalance(existingBooking.departmentId, costDifference, monthKey);
      if (!enough) {
        return {
          success: false,
          errors: [{ field: 'timeRange', message: `修改后费用增加${costDifference}元，部门月度预算不足` }]
        };
      }
    }
  }

  if (timeOrRoomChanged) {
    const roomConflicts = await checkRoomConflicts(room.id, date, startTime, endTime, id);
    if (roomConflicts.length > 0) {
      const conflictDescs = roomConflicts.map(c =>
        `与预约"${c.existingBooking.topic}"(${c.existingBooking.bookerName})在 ${c.overlapStart}-${c.overlapEnd} 冲突`
      ).join('; ');
      return {
        success: false,
        errors: [{ field: 'timeRange', message: `时间段冲突: ${conflictDescs}` }]
      };
    }

    const userConflicts = await checkUserConflicts(existingBooking.bookerName, date, startTime, endTime, id);
    if (userConflicts.length > 0) {
      const conflictDescs = userConflicts.map(c =>
        `您已预约"${c.existingBooking.topic}"(${c.existingBooking.roomNumber})在 ${c.overlapStart}-${c.overlapEnd}`
      ).join('; ');
      return {
        success: false,
        errors: [{ field: 'timeRange', message: `同一时段已有预约: ${conflictDescs}` }]
      };
    }
  }

  const updateData: any = {};
  if (input.roomNumber !== undefined && room) {
    updateData.roomId = room.id;
    updateData.roomNumber = input.roomNumber;
  }
  if (input.date !== undefined) updateData.date = input.date;
  if (input.startTime !== undefined) updateData.startTime = input.startTime;
  if (input.endTime !== undefined) updateData.endTime = input.endTime;
  if (input.attendeeCount !== undefined) updateData.attendeeCount = input.attendeeCount;
  if (input.topic !== undefined) updateData.topic = input.topic;

  if (newCostBreakdown) {
    updateData.totalCost = newCostBreakdown.totalCost;
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: updateData,
    include: { room: true }
  });

  if (timeOrRoomChanged && existingBooking.departmentId && newCostBreakdown && costDifference !== 0) {
    if (costDifference > 0) {
      await createBillingRecord({
        departmentId: existingBooking.departmentId,
        bookingId: id,
        roomId: room.id,
        roomNumber: room.roomNumber,
        date: date,
        type: 'charge_adjust',
        amount: costDifference,
        peakMinutes: newCostBreakdown.peakMinutes,
        offPeakMinutes: newCostBreakdown.offPeakMinutes,
        peakHoursCost: newCostBreakdown.peakHoursCost,
        offPeakHoursCost: newCostBreakdown.offPeakHoursCost,
        description: `修改预约补差价: ${updated.topic}，新增费用${costDifference}元`
      });
    } else {
      const refundAmount = Math.abs(costDifference);
      await prisma.booking.update({
        where: { id },
        data: { refundedAmount: (existingBooking.refundedAmount || 0) + refundAmount }
      });
      await createBillingRecord({
        departmentId: existingBooking.departmentId,
        bookingId: id,
        roomId: room.id,
        roomNumber: room.roomNumber,
        date: date,
        type: 'refund_adjust',
        amount: -refundAmount,
        description: `修改预约退差价: ${updated.topic}，退还${refundAmount}元`
      });
    }
  }

  if (timeOrRoomChanged) {
    const oldRoomId = existingBooking.roomId;
    const oldDate = existingBooking.date;
    const oldStartTime = existingBooking.startTime;
    const oldEndTime = existingBooking.endTime;

    const roomChanged = input.roomNumber && input.roomNumber !== existingBooking.roomNumber;
    const dateChanged = input.date && input.date !== existingBooking.date;
    const timeChanged = (input.startTime && input.startTime !== existingBooking.startTime) ||
                        (input.endTime && input.endTime !== existingBooking.endTime);

    if (roomChanged || dateChanged || timeChanged) {
      await processWaitlistForSlot(
        oldRoomId,
        oldDate,
        oldStartTime,
        oldEndTime,
        '预约改期'
      );

      if (roomChanged) {
        await processWaitlistForRoom(oldRoomId, oldDate, '房间调整');
      }
    }
  }

  return { success: true, data: { ...updated, costDifference, newCostBreakdown } };
}
