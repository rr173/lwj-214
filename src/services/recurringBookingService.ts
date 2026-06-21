import prisma from '../prisma';
import { addDays, addWeeks, format, parse, isAfter, isBefore, isEqual, differenceInDays } from 'date-fns';
import { validateBookerName, validateTopic, validateDate, validateTimeRange, validateAttendeeCount, validateCancelReason, ValidationError } from '../utils/validation';
import { isValidDateFormat } from '../utils/time';
import { getRoomByNumber } from './roomService';
import { checkRoomConflicts, checkUserConflicts } from './bookingService';
import { getDepartmentByName, hasEnoughBalance, getMonthKey } from './budgetService';
import { calculateCost, createBillingRecord, calculateRefund } from './billingService';
import { processWaitlistForSlot } from './waitlistService';
import { invalidateVisitorsByBookingId } from './visitorService';
import type { Booking } from '@prisma/client';

export type RecurringPattern = 'daily' | 'weekly' | 'biweekly';

export interface CreateRecurringBookingInput {
  bookerName: string;
  departmentName: string;
  roomNumber: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  topic: string;
  recurringPattern: RecurringPattern;
}

export interface SkippedDate {
  date: string;
  reason: string;
}

export interface CreateRecurringBookingResult {
  success: boolean;
  errors?: ValidationError[];
  data?: {
    recurringSeriesId: string;
    recurringPattern: RecurringPattern;
    recurringEndDate: string;
    createdBookings: Booking[];
    skippedDates: SkippedDate[];
    totalRequested: number;
    totalCreated: number;
    totalSkipped: number;
  };
}

export interface CancelRecurringInput {
  mode: 'single' | 'single_and_after';
  cancelReason: string;
}

function generateRecurringDates(
  startDate: string,
  endDate: string,
  pattern: RecurringPattern
): string[] {
  const dates: string[] = [];
  const start = parse(startDate, 'yyyy-MM-dd', new Date());
  const end = parse(endDate, 'yyyy-MM-dd', new Date());

  let current = start;
  while (isBefore(current, end) || isEqual(current, end)) {
    dates.push(format(current, 'yyyy-MM-dd'));
    switch (pattern) {
      case 'daily':
        current = addDays(current, 1);
        break;
      case 'weekly':
        current = addWeeks(current, 1);
        break;
      case 'biweekly':
        current = addWeeks(current, 2);
        break;
    }
  }

  return dates;
}

function validateRecurringEndDate(startDate: string, endDate: string): ValidationError | null {
  if (!endDate || typeof endDate !== 'string') {
    return { field: 'endDate', message: '重复结束日期不能为空' };
  }
  if (!isValidDateFormat(endDate)) {
    return { field: 'endDate', message: '重复结束日期格式必须为 YYYY-MM-DD' };
  }
  const start = parse(startDate, 'yyyy-MM-dd', new Date());
  const end = parse(endDate, 'yyyy-MM-dd', new Date());
  if (isBefore(end, start)) {
    return { field: 'endDate', message: '重复结束日期不能早于开始日期' };
  }
  const daysDiff = differenceInDays(end, start);
  if (daysDiff > 30) {
    return { field: 'endDate', message: '重复结束日期最远不能超过开始日期后30天' };
  }
  const today = parse(format(new Date(), 'yyyy-MM-dd'), 'yyyy-MM-dd', new Date());
  const maxDate = addDays(today, 30);
  if (isAfter(end, maxDate)) {
    return { field: 'endDate', message: '重复结束日期最远不能超过未来30天' };
  }
  return null;
}

function validateRecurringPattern(pattern: string): ValidationError | null {
  if (!pattern || typeof pattern !== 'string') {
    return { field: 'recurringPattern', message: '重复模式不能为空' };
  }
  const validPatterns: RecurringPattern[] = ['daily', 'weekly', 'biweekly'];
  if (!validPatterns.includes(pattern as RecurringPattern)) {
    return { field: 'recurringPattern', message: '重复模式必须是 daily、weekly 或 biweekly' };
  }
  return null;
}

export async function createRecurringBooking(input: CreateRecurringBookingInput): Promise<CreateRecurringBookingResult> {
  const errors: ValidationError[] = [];

  const bookerNameErr = validateBookerName(input.bookerName);
  if (bookerNameErr) errors.push(bookerNameErr);

  if (!input.departmentName || typeof input.departmentName !== 'string') {
    errors.push({ field: 'departmentName', message: '所属部门不能为空' });
  }

  const topicErr = validateTopic(input.topic);
  if (topicErr) errors.push(topicErr);

  const dateErr = validateDate(input.startDate);
  if (dateErr) errors.push(dateErr);

  const patternErr = validateRecurringPattern(input.recurringPattern);
  if (patternErr) errors.push(patternErr);

  const endDateErr = validateRecurringEndDate(input.startDate, input.endDate);
  if (endDateErr) errors.push(endDateErr);

  const timeErrors = validateTimeRange(input.startTime, input.endTime, input.startDate);
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

  if (room.isUnderMaintenance) {
    const today = new Date().toISOString().split('T')[0];
    if (room.maintenanceStartDate && room.maintenanceStartDate <= today) {
      return {
        success: false,
        errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 正在维护中，无法预约` }]
      };
    }
  }

  const costBreakdown = calculateCost(input.startTime, input.endTime, room.capacity);

  const dates = generateRecurringDates(input.startDate, input.endDate, input.recurringPattern);

  if (dates.length === 0) {
    return {
      success: false,
      errors: [{ field: 'dateRange', message: '未生成有效的重复日期序列' }]
    };
  }

  const recurringSeriesId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const createdBookings: Booking[] = [];
  const skippedDates: SkippedDate[] = [];
  let totalCostAccumulated = 0;
  const createdBookingIds: string[] = [];

  try {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];

      if (room.isUnderMaintenance && room.maintenanceStartDate && date >= room.maintenanceStartDate) {
        skippedDates.push({ date, reason: `会议室将于 ${room.maintenanceStartDate} 起维护，该日期无法预约` });
        continue;
      }

      const dateParse = parse(date, 'yyyy-MM-dd', new Date());
      const today = parse(format(new Date(), 'yyyy-MM-dd'), 'yyyy-MM-dd', new Date());
      if (isBefore(dateParse, today)) {
        skippedDates.push({ date, reason: '日期已过去，无法预约' });
        continue;
      }

      const roomConflicts = await checkRoomConflicts(room.id, date, input.startTime, input.endTime);
      if (roomConflicts.length > 0) {
        const conflictDescs = roomConflicts.map(c =>
          `与预约"${c.existingBooking.topic}"(${c.existingBooking.bookerName})在 ${c.overlapStart}-${c.overlapEnd} 冲突`
        ).join('; ');
        skippedDates.push({ date, reason: `时间段冲突: ${conflictDescs}` });
        continue;
      }

      const userConflicts = await checkUserConflicts(input.bookerName, date, input.startTime, input.endTime);
      if (userConflicts.length > 0) {
        const conflictDescs = userConflicts.map(c =>
          `您已预约"${c.existingBooking.topic}"(${c.existingBooking.roomNumber})在 ${c.overlapStart}-${c.overlapEnd}`
        ).join('; ');
        skippedDates.push({ date, reason: `同一时段已有预约: ${conflictDescs}` });
        continue;
      }

      const monthKey = getMonthKey(date);
      const enough = await hasEnoughBalance(department.id, costBreakdown.totalCost - totalCostAccumulated, monthKey);
      if (!enough) {
        skippedDates.push({ date, reason: `部门月度预算不足，该日期预约费用${costBreakdown.totalCost}元无法扣除` });
        continue;
      }

      const booking = await prisma.booking.create({
        data: {
          bookerName: input.bookerName,
          departmentId: department.id,
          roomId: room.id,
          roomNumber: input.roomNumber,
          date: date,
          startTime: input.startTime,
          endTime: input.endTime,
          attendeeCount: input.attendeeCount,
          topic: input.topic,
          totalCost: costBreakdown.totalCost,
          refundedAmount: 0,
          recurringSeriesId,
          recurringPattern: input.recurringPattern,
          recurringEndDate: input.endDate,
          recurringIndex: i
        }
      });

      await createBillingRecord({
        departmentId: department.id,
        bookingId: booking.id,
        roomId: room.id,
        roomNumber: input.roomNumber,
        date: date,
        type: 'charge',
        amount: costBreakdown.totalCost,
        peakMinutes: costBreakdown.peakMinutes,
        offPeakMinutes: costBreakdown.offPeakMinutes,
        peakHoursCost: costBreakdown.peakHoursCost,
        offPeakHoursCost: costBreakdown.offPeakHoursCost,
        description: `重复预约扣费[${recurringSeriesId}]: ${input.topic} (${date} ${input.startTime}-${input.endTime})`
      });

      totalCostAccumulated += costBreakdown.totalCost;
      createdBookings.push(booking);
      createdBookingIds.push(booking.id);
    }

    return {
      success: true,
      data: {
        recurringSeriesId,
        recurringPattern: input.recurringPattern,
        recurringEndDate: input.endDate,
        createdBookings,
        skippedDates,
        totalRequested: dates.length,
        totalCreated: createdBookings.length,
        totalSkipped: skippedDates.length
      }
    };
  } catch (e: any) {
    for (const bookingId of createdBookingIds) {
      const b = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (b && !b.isCancelled) {
        await prisma.booking.update({
          where: { id: bookingId },
          data: {
            isCancelled: true,
            cancelledAt: new Date(),
            cancelReason: '重复预约创建失败，回滚',
            recurringSeriesId: null,
            recurringPattern: null,
            recurringEndDate: null,
            recurringIndex: null
          }
        });
        if (b.totalCost && b.departmentId) {
          await createBillingRecord({
            departmentId: b.departmentId,
            bookingId: b.id,
            roomId: b.roomId,
            roomNumber: b.roomNumber,
            date: b.date,
            type: 'refund',
            amount: -(b.totalCost || 0),
            description: `重复预约创建失败回滚退费: ${b.topic}`
          });
        }
      }
    }
    throw e;
  }
}

export async function getBookingsByRecurringSeriesId(seriesId: string) {
  if (!seriesId || typeof seriesId !== 'string') {
    return {
      success: false,
      errors: [{ field: 'seriesId', message: '序列ID不能为空' }]
    };
  }

  const bookings = await prisma.booking.findMany({
    where: { recurringSeriesId: seriesId },
    orderBy: [
      { recurringIndex: 'asc' },
      { date: 'asc' },
      { startTime: 'asc' }
    ],
    include: { room: true }
  });

  if (bookings.length === 0) {
    return {
      success: false,
      errors: [{ field: 'seriesId', message: '未找到该序列的预约记录' }]
    };
  }

  const bookingsWithStatus = bookings.map(b => ({
    ...b,
    status: b.isCancelled ? 'cancelled' : b.isReleased ? 'released' : 'active'
  }));

  return {
    success: true,
    data: {
      recurringSeriesId: seriesId,
      recurringPattern: bookings[0].recurringPattern,
      recurringEndDate: bookings[0].recurringEndDate,
      totalBookings: bookingsWithStatus.length,
      activeBookings: bookingsWithStatus.filter(b => b.status === 'active').length,
      cancelledBookings: bookingsWithStatus.filter(b => b.status === 'cancelled').length,
      releasedBookings: bookingsWithStatus.filter(b => b.status === 'released').length,
      bookings: bookingsWithStatus
    }
  };
}

export async function cancelRecurringBooking(bookingId: string, input: CancelRecurringInput) {
  const reasonErr = validateCancelReason(input.cancelReason);
  if (reasonErr) {
    return { success: false, errors: [reasonErr] };
  }

  if (!input.mode || (input.mode !== 'single' && input.mode !== 'single_and_after')) {
    return {
      success: false,
      errors: [{ field: 'mode', message: '取消模式必须是 single 或 single_and_after' }]
    };
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    return {
      success: false,
      errors: [{ field: 'id', message: '预约不存在' }]
    };
  }

  const bookingIdsToCancel: string[] = [];

  if (input.mode === 'single') {
    bookingIdsToCancel.push(bookingId);
  } else if (input.mode === 'single_and_after') {
    if (!booking.recurringSeriesId || booking.recurringIndex === null || booking.recurringIndex === undefined) {
      return {
        success: false,
        errors: [{ field: 'id', message: '该预约不属于重复预约序列，无法使用"取消本条及之后"模式' }]
      };
    }

    const seriesBookings = await prisma.booking.findMany({
      where: {
        recurringSeriesId: booking.recurringSeriesId
      },
      orderBy: { recurringIndex: 'asc' }
    });

    const currentIndex = booking.recurringIndex;
    for (const sb of seriesBookings) {
      if (sb.recurringIndex !== null && sb.recurringIndex !== undefined && sb.recurringIndex >= currentIndex) {
        if (!sb.isCancelled) {
          bookingIdsToCancel.push(sb.id);
        }
      }
    }
  }

  const cancelResults: any[] = [];
  const cancelTime = new Date();

  for (const id of bookingIdsToCancel) {
    const b = await prisma.booking.findUnique({ where: { id } });
    if (!b || b.isCancelled) continue;

    let refundAmount = 0;
    if (b.totalCost && b.departmentId) {
      refundAmount = calculateRefund(b.totalCost, b.date, b.startTime, cancelTime);
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        isCancelled: true,
        cancelledAt: cancelTime,
        cancelReason: input.cancelReason,
        refundedAmount: refundAmount
      }
    });

    if (refundAmount > 0 && b.departmentId) {
      await createBillingRecord({
        departmentId: b.departmentId,
        bookingId: b.id,
        roomId: b.roomId,
        roomNumber: b.roomNumber,
        date: b.date,
        type: 'refund',
        amount: -refundAmount,
        description: `重复预约取消退费[${input.mode}]: ${b.topic}，退费${refundAmount}元，原因: ${input.cancelReason}`
      });
    }

    await prisma.bookingLog.create({
      data: {
        date: b.date,
        type: 'booking_cancelled',
        bookingId: b.id,
        description: `重复预约取消[${input.mode}]: ${b.bookerName} 的预约(${b.roomNumber} ${b.date} ${b.startTime}-${b.endTime})被取消，原因: ${input.cancelReason}，退费: ${refundAmount}元`
      }
    });

    await invalidateVisitorsByBookingId(b.id, '关联重复预约已取消');

    const conversions = await processWaitlistForSlot(
      b.roomId,
      b.date,
      b.startTime,
      b.endTime,
      '重复预约取消'
    );

    cancelResults.push({
      bookingId: b.id,
      date: b.date,
      refundAmount,
      waitlistConversions: conversions
    });
  }

  return {
    success: true,
    data: {
      mode: input.mode,
      totalCancelled: cancelResults.length,
      cancelledBookings: cancelResults
    }
  };
}
