import prisma from '../prisma';
import { format, addDays, differenceInMinutes, differenceInHours, parse, isAfter, isBefore, isEqual } from 'date-fns';
import { getRoomByNumber, queryRooms } from './roomService';
import { cancelBooking, checkRoomConflicts } from './bookingService';
import { processWaitlistForSlot } from './waitlistService';
import { validateBookerName, ValidationError } from '../utils/validation';
import { isValidTimeFormat, timeToMinutes } from '../utils/time';
import { findNextAvailableSlot } from './maintenancePersonService';

export const TICKET_STATUS = {
  PENDING_ASSIGNMENT: 'pending_assignment',
  IN_REPAIR: 'in_repair',
  COMPLETED: 'completed',
  CLOSED: 'closed'
};

export const URGENCY = {
  NORMAL: 'normal',
  URGENT: 'urgent'
};

export interface CreateTicketInput {
  roomNumber: string;
  facilityTag: string;
  description: string;
  reporterName: string;
  urgency: string;
}

export interface AssignTicketInput {
  ticketId: string;
  personId: string;
  estimatedFixDate: string;
  estimatedStartTime: string;
  estimatedEndTime: string;
}

export function validateUrgency(urgency: string): ValidationError | null {
  if (!urgency || (urgency !== URGENCY.NORMAL && urgency !== URGENCY.URGENT)) {
    return { field: 'urgency', message: '紧急程度必须是 normal 或 urgent' };
  }
  return null;
}

export function validateFacilityTag(tag: string): ValidationError | null {
  if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
    return { field: 'facilityTag', message: '故障设备标签不能为空' };
  }
  return null;
}

export function validateDescription(desc: string): ValidationError | null {
  if (!desc || typeof desc !== 'string' || desc.trim().length === 0) {
    return { field: 'description', message: '故障描述不能为空' };
  }
  if (desc.length > 500) {
    return { field: 'description', message: '故障描述不能超过500字' };
  }
  return null;
}

export function validateAssignee(name: string): ValidationError | null {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { field: 'assignee', message: '维修人员姓名不能为空' };
  }
  return null;
}

export function validateEstimatedFixDate(dateStr: string): ValidationError | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { field: 'estimatedFixDate', message: '预计修复日期格式不正确，应为 YYYY-MM-DD' };
  }
  return null;
}

function getToday(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function getTomorrow(): string {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd');
}

async function isRoomUnderMaintenance(roomId: string): Promise<boolean> {
  const room = await prisma.meetingRoom.findUnique({ where: { id: roomId } });
  return room?.isUnderMaintenance || false;
}

async function findSimilarRooms(roomId: string): Promise<any[]> {
  const room = await prisma.meetingRoom.findUnique({
    where: { id: roomId },
    include: { facilities: { include: { facility: true } } }
  });

  if (!room) return [];

  const facilityNames = room.facilities.map(f => f.facility.name);

  const allRooms = await queryRooms({
    minCapacity: room.capacity,
    maxCapacity: Math.floor(room.capacity * 1.5),
    facilities: facilityNames,
    isActive: true
  });

  return allRooms.filter(r => r.id !== roomId && !r.isUnderMaintenance);
}

async function cancelBookingsAndProcessWaitlists(roomId: string, startDate: string) {
  const today = getToday();
  const now = new Date();

  let bookingsToCancel;

  if (startDate > today) {
    bookingsToCancel = await prisma.booking.findMany({
      where: {
        roomId,
        isCancelled: false,
        isReleased: false,
        date: { gte: startDate }
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    });
  } else {
    bookingsToCancel = await prisma.booking.findMany({
      where: {
        roomId,
        isCancelled: false,
        isReleased: false,
        OR: [
          { date: { gt: startDate } },
          {
            date: startDate,
            startTime: { gt: format(now, 'HH:mm') }
          }
        ]
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    });
  }

  const results: any[] = [];

  for (const booking of bookingsToCancel) {
    const cancelResult = await cancelBooking(booking.id, '设备维护，房间临时关闭');
    if (cancelResult.success) {
      const similarRooms = await findSimilarRooms(roomId);
      let rebooked = false;

      for (const similarRoom of similarRooms) {
        const conflicts = await checkRoomConflicts(
          similarRoom.id,
          booking.date,
          booking.startTime,
          booking.endTime
        );

        if (conflicts.length === 0) {
          rebooked = true;
          break;
        }
      }

      results.push({
        bookingId: booking.id,
        topic: booking.topic,
        bookerName: booking.bookerName,
        date: booking.date,
        time: `${booking.startTime}-${booking.endTime}`,
        cancelled: true,
        canRebook: rebooked
      });
    }
  }

  const waitlists = await prisma.waitlist.findMany({
    where: {
      roomId,
      status: 'pending',
      OR: [
        { date: { gt: startDate } },
        { date: startDate }
      ]
    }
  });

  const waitlistResults: any[] = [];

  for (const wl of waitlists) {
    const similarRooms = await findSimilarRooms(roomId);
    let transferred = false;
    let targetRoom: any = null;

    for (const similarRoom of similarRooms) {
      const conflicts = await checkRoomConflicts(
        similarRoom.id,
        wl.date,
        wl.startTime,
        wl.endTime
      );

      if (conflicts.length === 0) {
        targetRoom = similarRoom;
        transferred = true;
        break;
      }
    }

    if (transferred && targetRoom) {
      await prisma.waitlist.update({
        where: { id: wl.id },
        data: {
          roomId: targetRoom.id,
          roomNumber: targetRoom.roomNumber,
          updatedAt: new Date()
        }
      });

      await processWaitlistForSlot(
        targetRoom.id,
        wl.date,
        wl.startTime,
        wl.endTime,
        '房间维护自动转房'
      );

      waitlistResults.push({
        waitlistId: wl.id,
        bookerName: wl.bookerName,
        fromRoom: wl.roomNumber,
        toRoom: targetRoom.roomNumber,
        date: wl.date,
        time: `${wl.startTime}-${wl.endTime}`,
        status: 'transferred'
      });
    } else {
      waitlistResults.push({
        waitlistId: wl.id,
        bookerName: wl.bookerName,
        roomNumber: wl.roomNumber,
        date: wl.date,
        time: `${wl.startTime}-${wl.endTime}`,
        status: 'cancelled'
      });
    }
  }

  return {
    cancelledBookings: results,
    affectedWaitlists: waitlistResults
  };
}

export async function createTicket(input: CreateTicketInput) {
  const errors: ValidationError[] = [];

  const reporterErr = validateBookerName(input.reporterName);
  if (reporterErr) errors.push(reporterErr);

  const urgencyErr = validateUrgency(input.urgency);
  if (urgencyErr) errors.push(urgencyErr);

  const facilityErr = validateFacilityTag(input.facilityTag);
  if (facilityErr) errors.push(facilityErr);

  const descErr = validateDescription(input.description);
  if (descErr) errors.push(descErr);

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

  if (!room.facilities.includes(input.facilityTag)) {
    return {
      success: false,
      errors: [{ field: 'facilityTag', message: `会议室 ${input.roomNumber} 没有设备: ${input.facilityTag}` }]
    };
  }

  if (room.isUnderMaintenance) {
    return {
      success: false,
      errors: [{ field: 'roomNumber', message: `会议室 ${input.roomNumber} 已处于维护状态` }]
    };
  }

  const ticket = await prisma.maintenanceTicket.create({
    data: {
      roomId: room.id,
      roomNumber: input.roomNumber,
      facilityTag: input.facilityTag,
      description: input.description,
      reporterName: input.reporterName,
      urgency: input.urgency,
      status: TICKET_STATUS.PENDING_ASSIGNMENT
    },
    include: { room: true }
  });

  let maintenanceEffect: any = null;

  if (input.urgency === URGENCY.URGENT) {
    const today = getToday();
    await prisma.meetingRoom.update({
      where: { id: room.id },
      data: {
        isUnderMaintenance: true,
        maintenanceStartDate: today
      }
    });

    maintenanceEffect = await cancelBookingsAndProcessWaitlists(room.id, today);
  } else if (input.urgency === URGENCY.NORMAL) {
    const tomorrow = getTomorrow();
    await prisma.meetingRoom.update({
      where: { id: room.id },
      data: {
        isUnderMaintenance: true,
        maintenanceStartDate: tomorrow
      }
    });

    maintenanceEffect = await cancelBookingsAndProcessWaitlists(room.id, tomorrow);
  }

  const updatedTicket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticket.id },
    include: { room: true }
  });

  return {
    success: true,
    data: {
      ticket: updatedTicket,
      maintenanceEffect
    }
  };
}

export async function assignTicket(input: AssignTicketInput) {
  const errors: ValidationError[] = [];

  if (!input.personId) {
    errors.push({ field: 'personId', message: '维修人员ID不能为空' });
  }

  const dateErr = validateEstimatedFixDate(input.estimatedFixDate);
  if (dateErr) errors.push(dateErr);

  if (!input.estimatedStartTime || !isValidTimeFormat(input.estimatedStartTime)) {
    errors.push({ field: 'estimatedStartTime', message: '预计开始时间格式不正确，应为 HH:mm' });
  }

  if (!input.estimatedEndTime || !isValidTimeFormat(input.estimatedEndTime)) {
    errors.push({ field: 'estimatedEndTime', message: '预计结束时间格式不正确，应为 HH:mm' });
  }

  if (input.estimatedStartTime && input.estimatedEndTime) {
    const startMin = timeToMinutes(input.estimatedStartTime);
    const endMin = timeToMinutes(input.estimatedEndTime);
    if (startMin >= endMin) {
      errors.push({ field: 'estimatedEndTime', message: '预计结束时间必须晚于开始时间' });
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const ticket = await prisma.maintenanceTicket.findUnique({ where: { id: input.ticketId } });
  if (!ticket) {
    return {
      success: false,
      errors: [{ field: 'ticketId', message: '工单不存在' }]
    };
  }

  if (ticket.status !== TICKET_STATUS.PENDING_ASSIGNMENT) {
    return {
      success: false,
      errors: [{ field: 'status', message: `工单当前状态为 ${ticket.status}，无法指派` }]
    };
  }

  const person = await prisma.maintenancePerson.findUnique({ where: { id: input.personId } });
  if (!person) {
    return {
      success: false,
      errors: [{ field: 'personId', message: '维修人员不存在' }]
    };
  }

  const durationMinutes = timeToMinutes(input.estimatedEndTime) - timeToMinutes(input.estimatedStartTime);

  const availability = await findNextAvailableSlot(
    input.personId,
    input.estimatedFixDate,
    durationMinutes,
    input.estimatedStartTime,
    input.estimatedEndTime
  );

  if (availability.conflict) {
    const conflictData: any = {
      success: false,
      conflicts: [{
        field: 'timeSlot',
        message: availability.conflictInfo?.outsideSchedule
          ? '指定时段不在该维修人员当日排班范围内'
          : '指定时段与该维修人员已有工单冲突'
      }]
    };

    if (availability.conflictInfo?.outsideSchedule) {
      conflictData.outsideSchedule = true;
    }

    if (availability.conflictInfo?.conflictingTickets) {
      conflictData.conflictingTickets = availability.conflictInfo.conflictingTickets;
    }

    if (availability.nextFreeSlot) {
      conflictData.nextAvailableSlot = availability.nextFreeSlot;
    }

    if (availability.availableSlots) {
      conflictData.availableSlots = availability.availableSlots;
    }

    return conflictData;
  }

  const updated = await prisma.maintenanceTicket.update({
    where: { id: input.ticketId },
    data: {
      assigneeId: input.personId,
      assignee: person.name,
      estimatedFixDate: input.estimatedFixDate,
      estimatedStartTime: input.estimatedStartTime,
      estimatedEndTime: input.estimatedEndTime,
      status: TICKET_STATUS.IN_REPAIR,
      assignedAt: new Date()
    },
    include: { room: true }
  });

  return { success: true, data: { ticket: updated } };
}

export async function completeTicket(ticketId: string) {
  const ticket = await prisma.maintenanceTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return {
      success: false,
      errors: [{ field: 'ticketId', message: '工单不存在' }]
    };
  }

  if (ticket.status !== TICKET_STATUS.IN_REPAIR) {
    return {
      success: false,
      errors: [{ field: 'status', message: `工单当前状态为 ${ticket.status}，无法完成` }]
    };
  }

  let actualDurationMinutes: number | null = null;
  if (ticket.assignedAt) {
    actualDurationMinutes = Math.max(1, differenceInMinutes(new Date(), ticket.assignedAt));
  }

  const updated = await prisma.maintenanceTicket.update({
    where: { id: ticketId },
    data: {
      status: TICKET_STATUS.COMPLETED,
      completedAt: new Date(),
      actualDurationMinutes
    },
    include: { room: true }
  });

  return { success: true, data: updated };
}

export async function closeTicket(ticketId: string) {
  const ticket = await prisma.maintenanceTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return {
      success: false,
      errors: [{ field: 'ticketId', message: '工单不存在' }]
    };
  }

  if (ticket.status !== TICKET_STATUS.COMPLETED) {
    return {
      success: false,
      errors: [{ field: 'status', message: `工单当前状态为 ${ticket.status}，无法关闭` }]
    };
  }

  const updated = await prisma.maintenanceTicket.update({
    where: { id: ticketId },
    data: {
      status: TICKET_STATUS.CLOSED,
      closedAt: new Date()
    },
    include: { room: true }
  });

  const activeTickets = await prisma.maintenanceTicket.findMany({
    where: {
      roomId: ticket.roomId,
      status: {
        in: [TICKET_STATUS.PENDING_ASSIGNMENT, TICKET_STATUS.IN_REPAIR]
      }
    }
  });

  if (activeTickets.length === 0) {
    await prisma.meetingRoom.update({
      where: { id: ticket.roomId },
      data: {
        isUnderMaintenance: false,
        maintenanceStartDate: null
      }
    });
  }

  return { success: true, data: updated };
}

export async function getTicketById(id: string) {
  return prisma.maintenanceTicket.findUnique({
    where: { id },
    include: { room: true }
  });
}

export async function getTicketsByRoom(roomNumber: string) {
  return prisma.maintenanceTicket.findMany({
    where: { roomNumber },
    orderBy: { submittedAt: 'desc' },
    include: { room: true }
  });
}

export async function getAllTickets(filters?: {
  status?: string;
  urgency?: string;
  roomNumber?: string;
}) {
  const where: any = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.urgency) where.urgency = filters.urgency;
  if (filters?.roomNumber) where.roomNumber = filters.roomNumber;

  return prisma.maintenanceTicket.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    include: { room: true }
  });
}

export async function getAverageRepairTime() {
  const completedTickets = await prisma.maintenanceTicket.findMany({
    where: {
      status: { in: [TICKET_STATUS.COMPLETED, TICKET_STATUS.CLOSED] },
      completedAt: { not: null }
    },
    include: { room: true }
  });

  const roomStats = new Map<string, { totalHours: number; count: number }>();

  for (const ticket of completedTickets) {
    if (!ticket.completedAt) continue;

    const durationHours = differenceInHours(ticket.completedAt, ticket.submittedAt);

    if (!roomStats.has(ticket.roomNumber)) {
      roomStats.set(ticket.roomNumber, { totalHours: 0, count: 0 });
    }

    const stats = roomStats.get(ticket.roomNumber)!;
    stats.totalHours += durationHours;
    stats.count += 1;
  }

  const result: any[] = [];
  for (const [roomNumber, stats] of roomStats) {
    result.push({
      roomNumber,
      averageRepairHours: Math.round((stats.totalHours / stats.count) * 100) / 100,
      completedTicketCount: stats.count,
      totalRepairHours: stats.totalHours
    });
  }

  result.sort((a, b) => b.averageRepairHours - a.averageRepairHours);

  return result;
}

export async function checkAndActivateMaintenance() {
  const today = getToday();

  const pendingTickets = await prisma.maintenanceTicket.findMany({
    where: {
      urgency: URGENCY.NORMAL,
      status: { in: [TICKET_STATUS.PENDING_ASSIGNMENT, TICKET_STATUS.IN_REPAIR] }
    },
    include: { room: true }
  });

  const results: any[] = [];

  for (const ticket of pendingTickets) {
    const room = ticket.room;
    if (room.isUnderMaintenance && room.maintenanceStartDate === today) {
      const effect = await cancelBookingsAndProcessWaitlists(room.id, today);
      results.push({
        ticketId: ticket.id,
        roomNumber: ticket.roomNumber,
        effect
      });
    }
  }

  return results;
}
