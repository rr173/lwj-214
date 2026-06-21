import prisma from '../prisma';
import { format, parse, differenceInMinutes, isSameMonth } from 'date-fns';
import { timeToMinutes, minutesToTime, isValidTimeFormat, isValidDateFormat, isTimeOverlap } from '../utils/time';
import { validateBookerName, ValidationError } from '../utils/validation';

export const MAX_DAILY_MINUTES = 8 * 60;

export interface RegisterPersonInput {
  name: string;
  employeeId: string;
  skills: string[];
}

export interface SetScheduleInput {
  personId: string;
  date: string;
  timeSlots: { startTime: string; endTime: string }[];
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
}

export function validateEmployeeId(id: string): ValidationError | null {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return { field: 'employeeId', message: '工号不能为空' };
  }
  return null;
}

export function validateSkills(skills: string[]): ValidationError | null {
  if (!Array.isArray(skills) || skills.length === 0) {
    return { field: 'skills', message: '技能标签列表不能为空' };
  }
  for (const skill of skills) {
    if (!skill || typeof skill !== 'string' || skill.trim().length === 0) {
      return { field: 'skills', message: '技能标签不能为空' };
    }
  }
  return null;
}

export function validateTimeSlots(timeSlots: { startTime: string; endTime: string }[]): ValidationError | null {
  if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
    return { field: 'timeSlots', message: '时段列表不能为空' };
  }

  let totalMinutes = 0;

  for (let i = 0; i < timeSlots.length; i++) {
    const slot = timeSlots[i];

    if (!slot.startTime || !isValidTimeFormat(slot.startTime)) {
      return { field: 'timeSlots', message: `第${i + 1}个时段开始时间格式不正确，应为 HH:mm` };
    }
    if (!slot.endTime || !isValidTimeFormat(slot.endTime)) {
      return { field: 'timeSlots', message: `第${i + 1}个时段结束时间格式不正确，应为 HH:mm` };
    }

    const startMin = timeToMinutes(slot.startTime);
    const endMin = timeToMinutes(slot.endTime);

    if (startMin >= endMin) {
      return { field: 'timeSlots', message: `第${i + 1}个时段结束时间必须晚于开始时间` };
    }

    totalMinutes += (endMin - startMin);

    for (let j = 0; j < i; j++) {
      const other = timeSlots[j];
      if (isTimeOverlap(slot.startTime, slot.endTime, other.startTime, other.endTime)) {
        return { field: 'timeSlots', message: `第${i + 1}个时段与第${j + 1}个时段重叠` };
      }
    }
  }

  if (totalMinutes > MAX_DAILY_MINUTES) {
    return { field: 'timeSlots', message: `每日排班总时长不能超过8小时，当前为${Math.round(totalMinutes / 60 * 10) / 10}小时` };
  }

  return null;
}

export async function registerMaintenancePerson(input: RegisterPersonInput) {
  const errors: ValidationError[] = [];

  const nameErr = validateBookerName(input.name);
  if (nameErr) errors.push(nameErr);

  const idErr = validateEmployeeId(input.employeeId);
  if (idErr) errors.push(idErr);

  const skillsErr = validateSkills(input.skills);
  if (skillsErr) errors.push(skillsErr);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const existing = await prisma.maintenancePerson.findUnique({ where: { employeeId: input.employeeId } });
  if (existing) {
    return {
      success: false,
      errors: [{ field: 'employeeId', message: `工号 ${input.employeeId} 已存在` }]
    };
  }

  const person = await prisma.maintenancePerson.create({
    data: {
      name: input.name,
      employeeId: input.employeeId,
      skills: JSON.stringify(input.skills)
    }
  });

  return {
    success: true,
    data: {
      ...person,
      skills: JSON.parse(person.skills)
    }
  };
}

export async function getAllMaintenancePersons() {
  const persons = await prisma.maintenancePerson.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  });

  return persons.map(p => ({
    ...p,
    skills: JSON.parse(p.skills)
  }));
}

export async function getMaintenancePersonById(id: string) {
  const person = await prisma.maintenancePerson.findUnique({ where: { id } });
  if (!person) return null;

  return {
    ...person,
    skills: JSON.parse(person.skills)
  };
}

export async function getMaintenancePersonByEmployeeId(employeeId: string) {
  const person = await prisma.maintenancePerson.findUnique({ where: { employeeId } });
  if (!person) return null;

  return {
    ...person,
    skills: JSON.parse(person.skills)
  };
}

export async function setPersonSchedule(input: SetScheduleInput) {
  const errors: ValidationError[] = [];

  if (!input.personId) {
    errors.push({ field: 'personId', message: '维修人员ID不能为空' });
  }

  if (!isValidDateFormat(input.date)) {
    errors.push({ field: 'date', message: '日期格式必须为 YYYY-MM-DD' });
  }

  const slotsErr = validateTimeSlots(input.timeSlots);
  if (slotsErr) errors.push(slotsErr);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const person = await prisma.maintenancePerson.findUnique({ where: { id: input.personId } });
  if (!person) {
    return {
      success: false,
      errors: [{ field: 'personId', message: '维修人员不存在' }]
    };
  }

  const existingTickets = await prisma.maintenanceTicket.findMany({
    where: {
      assigneeId: input.personId,
      estimatedFixDate: input.date,
      status: { in: ['pending_assignment', 'in_repair'] }
    }
  });

  for (const ticket of existingTickets) {
    if (!ticket.estimatedStartTime || !ticket.estimatedEndTime) continue;

    let withinSchedule = false;
    for (const slot of input.timeSlots) {
      if (
        timeToMinutes(ticket.estimatedStartTime) >= timeToMinutes(slot.startTime) &&
        timeToMinutes(ticket.estimatedEndTime) <= timeToMinutes(slot.endTime)
      ) {
        withinSchedule = true;
        break;
      }
    }

    if (!withinSchedule) {
      return {
        success: false,
        errors: [{
          field: 'timeSlots',
          message: `已指派的工单(${ticket.id})时间 ${ticket.estimatedStartTime}-${ticket.estimatedEndTime} 不在新排班时段内，请先调整工单`
        }]
      };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.maintenanceSchedule.deleteMany({
      where: { personId: input.personId, date: input.date }
    });

    const created = [];
    for (const slot of input.timeSlots) {
      const s = await tx.maintenanceSchedule.create({
        data: {
          personId: input.personId,
          date: input.date,
          startTime: slot.startTime,
          endTime: slot.endTime
        }
      });
      created.push(s);
    }

    return created;
  });

  return { success: true, data: result };
}

export async function getPersonSchedule(personId: string, date: string) {
  if (!isValidDateFormat(date)) {
    return { success: false, errors: [{ field: 'date', message: '日期格式必须为 YYYY-MM-DD' }] };
  }

  const schedules = await prisma.maintenanceSchedule.findMany({
    where: { personId, date },
    orderBy: { startTime: 'asc' }
  });

  return { success: true, data: schedules };
}

function mergeIntervals(intervals: { startTime: string; endTime: string }[]): { startTime: string; endTime: string }[] {
  if (intervals.length === 0) return [];

  const sorted = intervals
    .map(i => ({ start: timeToMinutes(i.startTime), end: timeToMinutes(i.endTime) }))
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push(curr);
    }
  }

  return merged.map(m => ({
    startTime: minutesToTime(m.start),
    endTime: minutesToTime(m.end)
  }));
}

export async function getPersonTicketsAndAvailability(personId: string, date: string) {
  if (!isValidDateFormat(date)) {
    return { success: false, errors: [{ field: 'date', message: '日期格式必须为 YYYY-MM-DD' }] };
  }

  const person = await prisma.maintenancePerson.findUnique({ where: { id: personId } });
  if (!person) {
    return { success: false, errors: [{ field: 'personId', message: '维修人员不存在' }] };
  }

  const schedules = await prisma.maintenanceSchedule.findMany({
    where: { personId, date },
    orderBy: { startTime: 'asc' }
  });

  const tickets = await prisma.maintenanceTicket.findMany({
    where: {
      assigneeId: personId,
      estimatedFixDate: date,
      status: { in: ['pending_assignment', 'in_repair', 'completed', 'closed'] }
    },
    include: { room: true },
    orderBy: { estimatedStartTime: 'asc' }
  });

  const scheduledMinutes = schedules.reduce(
    (sum, s) => sum + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)),
    0
  );

  const ticketIntervals = tickets
    .filter(t => t.estimatedStartTime && t.estimatedEndTime)
    .map(t => ({
      startTime: t.estimatedStartTime!,
      endTime: t.estimatedEndTime!
    }));

  const mergedTicketIntervals = mergeIntervals(ticketIntervals);

  const usedMinutes = mergedTicketIntervals.reduce(
    (sum, t) => sum + (timeToMinutes(t.endTime) - timeToMinutes(t.startTime)),
    0
  );

  const freeIntervals: { startTime: string; endTime: string }[] = [];

  for (const schedule of schedules) {
    let schStart = timeToMinutes(schedule.startTime);
    let schEnd = timeToMinutes(schedule.endTime);

    const relevantTickets = mergedTicketIntervals
      .map(t => ({ start: timeToMinutes(t.startTime), end: timeToMinutes(t.endTime) }))
      .filter(t => t.start < schEnd && t.end > schStart)
      .sort((a, b) => a.start - b.start);

    let cursor = schStart;
    for (const tk of relevantTickets) {
      if (tk.start > cursor) {
        freeIntervals.push({
          startTime: minutesToTime(cursor),
          endTime: minutesToTime(Math.min(tk.start, schEnd))
        });
      }
      cursor = Math.max(cursor, tk.end);
    }
    if (cursor < schEnd) {
      freeIntervals.push({
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(schEnd)
      });
    }
  }

  return {
    success: true,
    data: {
      person: { ...person, skills: JSON.parse(person.skills) },
      date,
      schedules,
      tickets: tickets.map(t => ({
        id: t.id,
        roomNumber: t.roomNumber,
        facilityTag: t.facilityTag,
        description: t.description,
        status: t.status,
        urgency: t.urgency,
        estimatedStartTime: t.estimatedStartTime,
        estimatedEndTime: t.estimatedEndTime,
        actualDurationMinutes: t.actualDurationMinutes
      })),
      scheduledMinutes,
      usedMinutes,
      remainingMinutes: scheduledMinutes - usedMinutes,
      freeSlots: mergeIntervals(freeIntervals)
    }
  };
}

export async function findNextAvailableSlot(
  personId: string,
  date: string,
  durationMinutes: number,
  requestedStart?: string,
  requestedEnd?: string
): Promise<{
  conflict: boolean;
  conflictInfo?: {
    date: string;
    requestedSlot?: string;
    outsideSchedule: boolean;
    conflictingTickets: { id: string; startTime: string; endTime: string; description: string }[];
  };
  nextFreeSlot?: { date: string; startTime: string; endTime: string };
  availableSlots?: { date: string; startTime: string; endTime: string }[];
}> {
  const scheduleResult = await getPersonTicketsAndAvailability(personId, date);
  if (!scheduleResult.success || !scheduleResult.data) {
    return { conflict: false };
  }

  const data = scheduleResult.data;
  const result: any = { conflict: false };

  if (requestedStart && requestedEnd) {
    let hasConflict = false;
    let outsideSchedule = false;

    const reqStartMin = timeToMinutes(requestedStart);
    const reqEndMin = timeToMinutes(requestedEnd);

    let withinAnySchedule = false;
    for (const sch of data.schedules) {
      if (reqStartMin >= timeToMinutes(sch.startTime) && reqEndMin <= timeToMinutes(sch.endTime)) {
        withinAnySchedule = true;
        break;
      }
    }

    if (!withinAnySchedule) {
      outsideSchedule = true;
      hasConflict = true;
    }

    const conflictingTickets: { id: string; startTime: string; endTime: string; description: string }[] = [];
    for (const t of data.tickets) {
      if (t.estimatedStartTime && t.estimatedEndTime) {
        if (isTimeOverlap(requestedStart, requestedEnd, t.estimatedStartTime, t.estimatedEndTime)) {
          hasConflict = true;
          conflictingTickets.push({
            id: t.id,
            startTime: t.estimatedStartTime,
            endTime: t.estimatedEndTime,
            description: t.description
          });
        }
      }
    }

    if (hasConflict) {
      result.conflict = true;
      result.conflictInfo = {
        date,
        requestedSlot: outsideSchedule ? undefined : `${requestedStart}-${requestedEnd}`,
        outsideSchedule,
        conflictingTickets
      };
    }
  }

  const availableSlots: { date: string; startTime: string; endTime: string }[] = [];
  for (const slot of data.freeSlots) {
    const slotDuration = timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime);
    if (slotDuration >= durationMinutes) {
      availableSlots.push({
        date,
        startTime: slot.startTime,
        endTime: minutesToTime(timeToMinutes(slot.startTime) + durationMinutes)
      });
    }
  }

  if (availableSlots.length > 0) {
    result.nextFreeSlot = availableSlots[0];
    result.availableSlots = availableSlots;
  }

  return result;
}

export async function getMonthlyPersonStatistics(month: string, personId?: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { success: false, errors: [{ field: 'month', message: '月份格式必须为 YYYY-MM' }] };
  }

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);

  const monthStart = new Date(year, monthNum - 1, 1);
  const monthEnd = new Date(year, monthNum, 0);

  const startDate = format(monthStart, 'yyyy-MM-dd');
  const endDate = format(monthEnd, 'yyyy-MM-dd');

  const whereClause: any = {
    status: { in: ['completed', 'closed'] },
    completedAt: { not: null },
    estimatedFixDate: { gte: startDate, lte: endDate }
  };

  if (personId) {
    whereClause.assigneeId = personId;
  }

  const tickets = await prisma.maintenanceTicket.findMany({
    where: whereClause,
    include: { person: true }
  });

  const statsMap = new Map<string, {
    personId: string;
    name: string;
    employeeId: string;
    skills: string[];
    totalActualMinutes: number;
    completedTickets: number;
  }>();

  for (const ticket of tickets) {
    if (!ticket.assigneeId || !ticket.person) continue;

    if (!statsMap.has(ticket.assigneeId)) {
      statsMap.set(ticket.assigneeId, {
        personId: ticket.assigneeId,
        name: ticket.person.name,
        employeeId: ticket.person.employeeId,
        skills: JSON.parse(ticket.person.skills),
        totalActualMinutes: 0,
        completedTickets: 0
      });
    }

    const stats = statsMap.get(ticket.assigneeId)!;
    stats.completedTickets += 1;

    if (ticket.actualDurationMinutes) {
      stats.totalActualMinutes += ticket.actualDurationMinutes;
    } else if (ticket.assignedAt && ticket.completedAt) {
      stats.totalActualMinutes += Math.max(1, differenceInMinutes(ticket.completedAt, ticket.assignedAt));
    }
  }

  const result = Array.from(statsMap.values()).map(stats => ({
    personId: stats.personId,
    name: stats.name,
    employeeId: stats.employeeId,
    skills: stats.skills,
    totalWorkMinutes: stats.totalActualMinutes,
    totalWorkHours: Math.round((stats.totalActualMinutes / 60) * 100) / 100,
    completedTickets: stats.completedTickets,
    averageMinutesPerTicket: stats.completedTickets > 0
      ? Math.round(stats.totalActualMinutes / stats.completedTickets)
      : 0,
    averageHoursPerTicket: stats.completedTickets > 0
      ? Math.round((stats.totalActualMinutes / stats.completedTickets / 60) * 100) / 100
      : 0
  }));

  result.sort((a, b) => b.totalWorkMinutes - a.totalWorkMinutes);

  return {
    success: true,
    data: {
      month,
      totalWorkers: result.length,
      totalCompletedTickets: result.reduce((sum, r) => sum + r.completedTickets, 0),
      totalWorkMinutes: result.reduce((sum, r) => sum + r.totalWorkMinutes, 0),
      totalWorkHours: Math.round((result.reduce((sum, r) => sum + r.totalWorkMinutes, 0) / 60) * 100) / 100,
      personStatistics: result
    }
  };
}
