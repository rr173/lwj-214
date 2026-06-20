import prisma from '../prisma';
import { isTimeOverlap } from '../utils/time';
import { validateDate, validateTimeRange, validateAttendeeCount, validateBookerName, validateTopic, ValidationError } from '../utils/validation';
import { getRoomByNumber } from './roomService';
import { checkRoomConflicts } from './bookingService';

export interface CreateWaitlistInput {
  bookerName: string;
  roomNumber: string;
  date: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  requiredFacilities: string[];
  topic: string;
}

export async function createWaitlist(input: CreateWaitlistInput) {
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
      errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 已停用` }]
    };
  }

  const attendeeErr = validateAttendeeCount(input.attendeeCount, room.capacity);
  if (attendeeErr) {
    return { success: false, errors: [attendeeErr] };
  }

  if (input.requiredFacilities && input.requiredFacilities.length > 0) {
    const missing = input.requiredFacilities.filter(f => !room.facilities.includes(f));
    if (missing.length > 0) {
      return {
        success: false,
        errors: [{ field: 'requiredFacilities', message: `会议室缺少必需设备: ${missing.join(', ')}` }]
      };
    }
  }

  const existingWaitlist = await prisma.waitlist.findFirst({
    where: {
      bookerName: input.bookerName,
      date: input.date,
      status: 'pending',
      OR: [
        {
          startTime: { lt: input.endTime },
          endTime: { gt: input.startTime }
        }
      ]
    }
  });

  if (existingWaitlist) {
    return {
      success: false,
      errors: [{ field: 'bookerName', message: '同一人在同一时段只能保留一个有效候补' }]
    };
  }

  const hasActiveBooking = await prisma.booking.findFirst({
    where: {
      bookerName: input.bookerName,
      date: input.date,
      isCancelled: false,
      isReleased: false,
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime }
    }
  });

  if (hasActiveBooking) {
    return {
      success: false,
      errors: [{ field: 'bookerName', message: '同一人在同一时段已有预约，无需候补' }]
    };
  }

  const waitlist = await prisma.waitlist.create({
    data: {
      bookerName: input.bookerName,
      roomId: room.id,
      roomNumber: input.roomNumber,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      attendeeCount: input.attendeeCount,
      requiredFacilities: JSON.stringify(input.requiredFacilities || []),
      topic: input.topic
    },
    include: { room: true }
  });

  return { success: true, data: waitlist };
}

export async function getWaitlistList(filters?: {
  roomNumber?: string;
  date?: string;
  status?: string;
  bookerName?: string;
}) {
  const where: any = {};
  if (filters?.roomNumber) where.roomNumber = filters.roomNumber;
  if (filters?.date) where.date = filters.date;
  if (filters?.status) where.status = filters.status;
  if (filters?.bookerName) where.bookerName = filters.bookerName;

  return prisma.waitlist.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { room: true }
  });
}

export async function getWaitlistById(id: string) {
  return prisma.waitlist.findUnique({
    where: { id },
    include: { room: true }
  });
}

export async function cancelWaitlist(id: string) {
  const waitlist = await getWaitlistById(id);
  if (!waitlist) {
    return {
      success: false,
      errors: [{ field: 'id', message: '候补记录不存在' }]
    };
  }

  if (waitlist.status !== 'pending') {
    return {
      success: false,
      errors: [{ field: 'id', message: `候补状态为${waitlist.status}，无法取消` }]
    };
  }

  const updated = await prisma.waitlist.update({
    where: { id },
    data: { status: 'cancelled', updatedAt: new Date() },
    include: { room: true }
  });

  return { success: true, data: updated };
}

export async function processWaitlistForSlot(roomId: string, date: string, startTime: string, endTime: string, source: string) {
  const pendingWaitlists = await prisma.waitlist.findMany({
    where: {
      roomId,
      date,
      status: 'pending'
    },
    orderBy: { createdAt: 'asc' }
  });

  const results: any[] = [];

  for (const wl of pendingWaitlists) {
    if (!isTimeOverlap(wl.startTime, wl.endTime, startTime, endTime)) {
      continue;
    }

    const conflicts = await checkRoomConflicts(wl.roomId, wl.date, wl.startTime, wl.endTime);
    if (conflicts.length > 0) {
      continue;
    }

    const booking = await prisma.booking.create({
      data: {
        bookerName: wl.bookerName,
        roomId: wl.roomId,
        roomNumber: wl.roomNumber,
        date: wl.date,
        startTime: wl.startTime,
        endTime: wl.endTime,
        attendeeCount: wl.attendeeCount,
        topic: wl.topic,
        convertedFromWaitlistId: wl.id,
        convertedFromWaitlistAt: new Date()
      }
    });

    await prisma.waitlist.update({
      where: { id: wl.id },
      data: {
        status: 'converted',
        convertedAt: new Date(),
        convertedSource: source,
        convertedBookingId: booking.id,
        updatedAt: new Date()
      }
    });

    await prisma.bookingLog.create({
      data: {
        date: wl.date,
        type: 'waitlist_converted',
        bookingId: booking.id,
        waitlistId: wl.id,
        description: `候补转正: ${wl.bookerName} 的候补(${wl.roomNumber} ${wl.date} ${wl.startTime}-${wl.endTime})因[${source}]转为正式预约`
      }
    });

    results.push({
      waitlistId: wl.id,
      bookingId: booking.id,
      bookerName: wl.bookerName,
      roomNumber: wl.roomNumber,
      timeSlot: `${wl.startTime}-${wl.endTime}`
    });
  }

  return results;
}

export async function processWaitlistForRoom(roomId: string, date: string, source: string) {
  const pendingWaitlists = await prisma.waitlist.findMany({
    where: {
      roomId,
      date,
      status: 'pending'
    },
    orderBy: { createdAt: 'asc' }
  });

  const results: any[] = [];

  for (const wl of pendingWaitlists) {
    const conflicts = await checkRoomConflicts(wl.roomId, wl.date, wl.startTime, wl.endTime);
    if (conflicts.length > 0) {
      continue;
    }

    const booking = await prisma.booking.create({
      data: {
        bookerName: wl.bookerName,
        roomId: wl.roomId,
        roomNumber: wl.roomNumber,
        date: wl.date,
        startTime: wl.startTime,
        endTime: wl.endTime,
        attendeeCount: wl.attendeeCount,
        topic: wl.topic,
        convertedFromWaitlistId: wl.id,
        convertedFromWaitlistAt: new Date()
      }
    });

    await prisma.waitlist.update({
      where: { id: wl.id },
      data: {
        status: 'converted',
        convertedAt: new Date(),
        convertedSource: source,
        convertedBookingId: booking.id,
        updatedAt: new Date()
      }
    });

    await prisma.bookingLog.create({
      data: {
        date: wl.date,
        type: 'waitlist_converted',
        bookingId: booking.id,
        waitlistId: wl.id,
        description: `候补转正: ${wl.bookerName} 的候补(${wl.roomNumber} ${wl.date} ${wl.startTime}-${wl.endTime})因[${source}]转为正式预约`
      }
    });

    results.push({
      waitlistId: wl.id,
      bookingId: booking.id,
      bookerName: wl.bookerName,
      roomNumber: wl.roomNumber,
      timeSlot: `${wl.startTime}-${wl.endTime}`
    });
  }

  return results;
}

export async function getDailyLogs(date: string) {
  return prisma.bookingLog.findMany({
    where: { date },
    orderBy: { createdAt: 'desc' },
    include: {
      booking: true,
      waitlist: true
    }
  });
}
