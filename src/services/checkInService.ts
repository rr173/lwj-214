import prisma from '../prisma';
import { processWaitlistForSlot } from './waitlistService';

const CHECK_IN_BEFORE_MINUTES = 10;
const CHECK_IN_AFTER_MINUTES = 15;

function buildBookingDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0);
}

export function canCheckIn(booking: { date: string; startTime: string; isCancelled: boolean; isReleased: boolean; checkInTime: Date | null }): { allowed: boolean; reason?: string } {
  if (booking.isCancelled) {
    return { allowed: false, reason: '预约已取消，无法签到' };
  }
  if (booking.isReleased) {
    return { allowed: false, reason: '预约已释放，无法签到' };
  }
  if (booking.checkInTime) {
    return { allowed: false, reason: '已经签到过了' };
  }

  const now = new Date();
  const bookingStart = buildBookingDateTime(booking.date, booking.startTime);
  const checkInOpen = new Date(bookingStart.getTime() - CHECK_IN_BEFORE_MINUTES * 60 * 1000);
  const checkInClose = new Date(bookingStart.getTime() + CHECK_IN_AFTER_MINUTES * 60 * 1000);

  if (now < checkInOpen) {
    return { allowed: false, reason: `签到窗口尚未开启（开始前${CHECK_IN_BEFORE_MINUTES}分钟开放）` };
  }
  if (now > checkInClose) {
    return { allowed: false, reason: `签到窗口已关闭（开始后${CHECK_IN_AFTER_MINUTES}分钟截止）` };
  }

  return { allowed: true };
}

export async function checkIn(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    return { success: false, errors: [{ field: 'id', message: '预约不存在' }] };
  }

  const check = canCheckIn(booking);
  if (!check.allowed) {
    return { success: false, errors: [{ field: 'checkIn', message: check.reason! }] };
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { checkInTime: new Date() },
    include: { room: true }
  });

  return { success: true, data: updated };
}

export async function releaseNoShowBookings(): Promise<any[]> {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const activeBookings = await prisma.booking.findMany({
    where: {
      isCancelled: false,
      isReleased: false,
      checkInTime: null,
      date: todayStr
    }
  });

  const released: any[] = [];

  for (const booking of activeBookings) {
    const bookingStart = buildBookingDateTime(booking.date, booking.startTime);
    const deadline = new Date(bookingStart.getTime() + CHECK_IN_AFTER_MINUTES * 60 * 1000);

    if (now > deadline) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          isReleased: true,
          releasedAt: new Date(),
          isCancelled: true,
          cancelledAt: new Date(),
          cancelReason: '未签到自动释放'
        }
      });

      await prisma.bookingLog.create({
        data: {
          date: booking.date,
          type: 'no_show_release',
          bookingId: booking.id,
          description: `未签到释放: ${booking.bookerName} 的预约(${booking.roomNumber} ${booking.date} ${booking.startTime}-${booking.endTime})因超时未签到自动释放`
        }
      });

      const conversions = await processWaitlistForSlot(
        booking.roomId,
        booking.date,
        booking.startTime,
        booking.endTime,
        '未签到释放'
      );

      released.push({
        bookingId: booking.id,
        bookerName: booking.bookerName,
        roomNumber: booking.roomNumber,
        timeSlot: `${booking.startTime}-${booking.endTime}`,
        conversions
      });
    }
  }

  return released;
}
