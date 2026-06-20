import prisma from '../prisma';
import { isTimeOverlap, getOverlapTimeRange } from '../utils/time';
import {
  validateDate, validateTimeRange, validateAttendeeCount,
  validateBookerName, validateTopic, validateCancelReason,
  ValidationError
} from '../utils/validation';
import { getRoomByNumber } from './roomService';
import type { MeetingRoom, Booking } from '@prisma/client';

export interface CreateBookingInput {
  bookerName: string;
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

  const topicErr = validateTopic(input.topic);
  if (topicErr) errors.push(topicErr);

  const dateErr = validateDate(input.date);
  if (dateErr) errors.push(dateErr);

  const timeErrors = validateTimeRange(input.startTime, input.endTime, input.date);
  errors.push(...timeErrors);

  if (errors.length > 0) {
    return { success: false, errors };
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
      roomId: room.id,
      roomNumber: input.roomNumber,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      attendeeCount: input.attendeeCount,
      topic: input.topic
    }
  });

  return { success: true, data: booking };
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

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      isCancelled: true,
      cancelledAt: new Date(),
      cancelReason
    }
  });

  return { success: true, data: updated };
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

  if (input.attendeeCount !== undefined) {
    const attendeeErr = validateAttendeeCount(input.attendeeCount, room.capacity);
    if (attendeeErr) {
      return { success: false, errors: [attendeeErr] };
    }
  }

  if (input.roomNumber || input.date || input.startTime || input.endTime) {
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

  const updated = await prisma.booking.update({
    where: { id },
    data: updateData,
    include: { room: true }
  });

  return { success: true, data: updated };
}
