import prisma from '../prisma';
import { getBookingById } from './bookingService';
import {
  ValidationError
} from '../utils/validation';

const VISITOR_CHECK_IN_BEFORE_MINUTES = 30;
const VISITOR_CHECK_IN_AFTER_MINUTES = 15;
const MAX_VISITORS_PER_BOOKING = 5;

export interface RegisterVisitorInput {
  visitorName: string;
  phoneLastFour: string;
  visitReason: string;
  hostName: string;
  bookingId: string;
}

export interface VisitorStatusEnum {
  PENDING: 'pending';
  CHECKED_IN: 'checked_in';
  INVALIDATED: 'invalidated';
}

function generateCheckInCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildBookingDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0);
}

function validateVisitorName(name: string): ValidationError | null {
  if (!name || typeof name !== 'string') {
    return { field: 'visitorName', message: '访客姓名不能为空' };
  }
  if (name.length > 50) {
    return { field: 'visitorName', message: '访客姓名不能超过50个字符' };
  }
  return null;
}

function validatePhoneLastFour(phone: string): ValidationError | null {
  if (!phone || typeof phone !== 'string') {
    return { field: 'phoneLastFour', message: '手机号后四位不能为空' };
  }
  if (!/^\d{4}$/.test(phone)) {
    return { field: 'phoneLastFour', message: '手机号后四位必须是4位数字' };
  }
  return null;
}

function validateVisitReason(reason: string): ValidationError | null {
  if (!reason || typeof reason !== 'string') {
    return { field: 'visitReason', message: '来访事由不能为空' };
  }
  if (reason.length > 200) {
    return { field: 'visitReason', message: '来访事由不能超过200个字符' };
  }
  return null;
}

function validateHostName(name: string): ValidationError | null {
  if (!name || typeof name !== 'string') {
    return { field: 'hostName', message: '接待人姓名不能为空' };
  }
  if (name.length > 50) {
    return { field: 'hostName', message: '接待人姓名不能超过50个字符' };
  }
  return null;
}

export function canVisitorCheckIn(visitor: {
  date: string;
  startTime: string;
  status: string;
}): { allowed: boolean; reason?: string } {
  if (visitor.status === 'checked_in') {
    return { allowed: false, reason: '访客已签到' };
  }
  if (visitor.status === 'invalidated') {
    return { allowed: false, reason: '访客登记已失效' };
  }

  const now = new Date();
  const bookingStart = buildBookingDateTime(visitor.date, visitor.startTime);
  const checkInOpen = new Date(bookingStart.getTime() - VISITOR_CHECK_IN_BEFORE_MINUTES * 60 * 1000);
  const checkInClose = new Date(bookingStart.getTime() + VISITOR_CHECK_IN_AFTER_MINUTES * 60 * 1000);

  if (now < checkInOpen) {
    return { allowed: false, reason: `签到窗口尚未开启（开始前${VISITOR_CHECK_IN_BEFORE_MINUTES}分钟开放）` };
  }
  if (now > checkInClose) {
    return { allowed: false, reason: `签到窗口已关闭（开始后${VISITOR_CHECK_IN_AFTER_MINUTES}分钟截止）` };
  }

  return { allowed: true };
}

export async function registerVisitor(input: RegisterVisitorInput) {
  const errors: ValidationError[] = [];

  const nameErr = validateVisitorName(input.visitorName);
  if (nameErr) errors.push(nameErr);

  const phoneErr = validatePhoneLastFour(input.phoneLastFour);
  if (phoneErr) errors.push(phoneErr);

  const reasonErr = validateVisitReason(input.visitReason);
  if (reasonErr) errors.push(reasonErr);

  const hostErr = validateHostName(input.hostName);
  if (hostErr) errors.push(hostErr);

  if (!input.bookingId) {
    errors.push({ field: 'bookingId', message: '关联预约ID不能为空' });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const booking = await getBookingById(input.bookingId);
  if (!booking) {
    return {
      success: false,
      errors: [{ field: 'bookingId', message: '关联预约不存在' }]
    };
  }

  if (booking.isCancelled) {
    return {
      success: false,
      errors: [{ field: 'bookingId', message: '关联预约已取消，无法登记访客' }]
    };
  }

  if (booking.isReleased) {
    return {
      success: false,
      errors: [{ field: 'bookingId', message: '关联预约已释放，无法登记访客' }]
    };
  }

  if (booking.bookerName !== input.hostName) {
    return {
      success: false,
      errors: [{ field: 'hostName', message: '接待人必须是该预约的预约人' }]
    };
  }

  const visitorCount = await prisma.visitor.count({
    where: {
      bookingId: input.bookingId,
      status: { in: ['pending', 'checked_in'] }
    }
  });

  if (visitorCount >= MAX_VISITORS_PER_BOOKING) {
    return {
      success: false,
      errors: [{ field: 'bookingId', message: `每个预约最多关联${MAX_VISITORS_PER_BOOKING}位访客` }]
    };
  }

  let checkInCode: string;
  let codeExists = true;
  let attempts = 0;

  while (codeExists && attempts < 10) {
    checkInCode = generateCheckInCode();
    const existing = await prisma.visitor.findUnique({ where: { checkInCode } });
    if (!existing) {
      codeExists = false;
    }
    attempts++;
  }

  if (codeExists!) {
    return {
      success: false,
      errors: [{ field: 'checkInCode', message: '生成签到码失败，请稍后重试' }]
    };
  }

  const visitor = await prisma.visitor.create({
    data: {
      visitorName: input.visitorName,
      phoneLastFour: input.phoneLastFour,
      visitReason: input.visitReason,
      hostName: input.hostName,
      bookingId: input.bookingId,
      checkInCode: checkInCode!,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      roomNumber: booking.roomNumber
    }
  });

  return { success: true, data: visitor };
}

export async function visitorCheckIn(checkInCode: string) {
  if (!checkInCode) {
    return {
      success: false,
      errors: [{ field: 'checkInCode', message: '签到码不能为空' }]
    };
  }

  const visitor = await prisma.visitor.findUnique({ where: { checkInCode } });
  if (!visitor) {
    return {
      success: false,
      errors: [{ field: 'checkInCode', message: '签到码无效' }]
    };
  }

  const check = canVisitorCheckIn(visitor);
  if (!check.allowed) {
    return { success: false, errors: [{ field: 'checkIn', message: check.reason! }] };
  }

  const updated = await prisma.visitor.update({
    where: { id: visitor.id },
    data: {
      status: 'checked_in',
      checkInTime: new Date()
    }
  });

  return { success: true, data: updated };
}

export async function getVisitorsByBookingId(bookingId: string) {
  return prisma.visitor.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' }
  });
}

export async function getVisitorsByDate(date: string, status?: string) {
  const where: any = { date };
  if (status) {
    where.status = status;
  }
  return prisma.visitor.findMany({
    where,
    orderBy: { createdAt: 'asc' }
  });
}

export async function getVisitorsByHostName(hostName: string) {
  return prisma.visitor.findMany({
    where: { hostName },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
  });
}

export async function getVisitorById(id: string) {
  return prisma.visitor.findUnique({ where: { id } });
}

export async function invalidateVisitorsByBookingId(bookingId: string, reason: string) {
  const result = await prisma.visitor.updateMany({
    where: {
      bookingId,
      status: 'pending'
    },
    data: {
      status: 'invalidated',
      invalidatedAt: new Date(),
      invalidatedReason: reason
    }
  });
  return result.count;
}
