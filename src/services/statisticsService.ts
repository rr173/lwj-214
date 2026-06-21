import prisma from '../prisma';
import { parse, differenceInDays, format, isAfter, isBefore } from 'date-fns';
import { timeToMinutes, WORK_START, WORK_END } from '../utils/time';
import { isValidDateFormat } from '../utils/time';
import type { Booking, MeetingRoom } from '@prisma/client';

export interface StatisticsInput {
  startDate: string;
  endDate: string;
}

export interface HourlyStats {
  hour: string;
  count: number;
}

export interface RoomStatistics {
  roomNumber: string;
  roomName: string;
  capacity: number;
  floor: number;
  usageRate: number;
  totalBookedMinutes: number;
  totalWorkingMinutes: number;
  topHours: HourlyStats[];
  averageAttendees: number;
  totalBookings: number;
  cancelledBookings: number;
  cancellationRate: number;
  noShowReleasedBookings: number;
  waitlistConvertedBookings: number;
  effectiveBookings: number;
  effectiveCancellationRate: number;
  totalVisitors: number;
  dailyAverageVisitors: number;
  recurringBookings: number;
  recurringBookingRate: number;
}

export async function getWeeklyStatistics(input: StatisticsInput) {
  if (!input.startDate || !input.endDate) {
    return {
      success: false,
      errors: [{ field: 'dateRange', message: '开始日期和结束日期不能为空' }]
    };
  }

  if (!isValidDateFormat(input.startDate)) {
    return {
      success: false,
      errors: [{ field: 'startDate', message: '开始日期格式必须为 YYYY-MM-DD' }]
    };
  }

  if (!isValidDateFormat(input.endDate)) {
    return {
      success: false,
      errors: [{ field: 'endDate', message: '结束日期格式必须为 YYYY-MM-DD' }]
    };
  }

  const start = parse(input.startDate, 'yyyy-MM-dd', new Date());
  const end = parse(input.endDate, 'yyyy-MM-dd', new Date());
  const daysDiff = differenceInDays(end, start);

  if (daysDiff < 0) {
    return {
      success: false,
      errors: [{ field: 'dateRange', message: '结束日期不能早于开始日期' }]
    };
  }

  if (daysDiff > 30) {
    return {
      success: false,
      errors: [{ field: 'dateRange', message: '日期范围最长为31天' }]
    };
  }

  const allRooms = await prisma.meetingRoom.findMany({
    where: {
      splitStatus: { not: 'sub' }
    },
    include: {
      subRooms: true
    }
  });

  const allBookings = await prisma.booking.findMany({
    where: {
      date: { gte: input.startDate, lte: input.endDate }
    }
  });

  const allVisitors = await prisma.visitor.findMany({
    where: {
      date: { gte: input.startDate, lte: input.endDate }
    }
  });

  const totalDays = daysDiff + 1;
  const dailyWorkingMinutes = timeToMinutes(WORK_END) - timeToMinutes(WORK_START);
  const totalWorkingMinutes = totalDays * dailyWorkingMinutes;

  const roomStats: RoomStatistics[] = [];

  function calculateRoomStats(
    room: MeetingRoom & { subRooms?: MeetingRoom[] },
    bookings: Booking[],
    visitors: any[]
  ): RoomStatistics {
    const cancelledBookings = bookings.filter(b => b.isCancelled && !b.isReleased);
    const noShowReleasedBookings = bookings.filter(b => b.isReleased);
    const waitlistConvertedBookings = bookings.filter(b => b.convertedFromWaitlistId !== null && !b.isCancelled);
    const activeBookings = bookings.filter(b => !b.isCancelled);
    const recurringBookings = bookings.filter(b => b.recurringSeriesId !== null);

    let totalBookedMinutes = 0;
    const hourCounts = new Map<string, number>();

    for (let h = 8; h < 22; h++) {
      hourCounts.set(`${h.toString().padStart(2, '0')}:00`, 0);
    }

    for (const booking of activeBookings) {
      const startMin = timeToMinutes(booking.startTime);
      const endMin = timeToMinutes(booking.endTime);
      totalBookedMinutes += (endMin - startMin);

      const startHour = Math.floor(startMin / 60);
      const endHour = Math.floor((endMin - 1) / 60);
      for (let h = startHour; h <= endHour; h++) {
        const hourKey = `${h.toString().padStart(2, '0')}:00`;
        hourCounts.set(hourKey, (hourCounts.get(hourKey) || 0) + 1);
      }
    }

    const usageRate = totalWorkingMinutes > 0 ? (totalBookedMinutes / totalWorkingMinutes) * 100 : 0;

    const totalAttendees = activeBookings.reduce((sum, b) => sum + b.attendeeCount, 0);
    const averageAttendees = activeBookings.length > 0 ? totalAttendees / activeBookings.length : 0;

    const totalBookings = bookings.length;
    const cancellationRate = totalBookings > 0 ? (cancelledBookings.length / totalBookings) * 100 : 0;
    const effectiveBookings = activeBookings.length;
    const effectiveCancellationRate = totalBookings > 0
      ? ((cancelledBookings.length + noShowReleasedBookings.length) / totalBookings) * 100
      : 0;

    const totalVisitors = visitors.length;
    const dailyAverageVisitors = totalDays > 0 ? totalVisitors / totalDays : 0;

    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour, count]) => ({ hour, count }));

    return {
      roomNumber: room.roomNumber,
      roomName: room.name,
      capacity: room.capacity,
      floor: room.floor,
      usageRate: Math.round(usageRate * 100) / 100,
      totalBookedMinutes,
      totalWorkingMinutes,
      topHours: sortedHours,
      averageAttendees: Math.round(averageAttendees * 100) / 100,
      totalBookings,
      cancelledBookings: cancelledBookings.length,
      cancellationRate: Math.round(cancellationRate * 100) / 100,
      noShowReleasedBookings: noShowReleasedBookings.length,
      waitlistConvertedBookings: waitlistConvertedBookings.length,
      effectiveBookings,
      effectiveCancellationRate: Math.round(effectiveCancellationRate * 100) / 100,
      totalVisitors,
      dailyAverageVisitors: Math.round(dailyAverageVisitors * 100) / 100,
      recurringBookings: recurringBookings.length,
      recurringBookingRate: totalBookings > 0 ? Math.round((recurringBookings.length / totalBookings) * 10000) / 100 : 0
    };
  }

  for (const room of allRooms) {
    const roomIds = [room.id];
    if (room.subRooms && room.subRooms.length > 0) {
      roomIds.push(...room.subRooms.map(sr => sr.id));
    }

    const roomBookings = allBookings.filter(b => roomIds.includes(b.roomId));
    const roomVisitorList = allVisitors.filter(v => {
      const booking = allBookings.find(b => b.id === v.bookingId);
      return booking && roomIds.includes(booking.roomId);
    });
    const stats = calculateRoomStats(room, roomBookings, roomVisitorList);
    roomStats.push(stats);
  }

  const allCancelled = allBookings.filter(b => b.isCancelled && !b.isReleased);
  const allNoShowReleased = allBookings.filter(b => b.isReleased);
  const allWaitlistConverted = allBookings.filter(b => b.convertedFromWaitlistId !== null && !b.isCancelled);
  const allActive = allBookings.filter(b => !b.isCancelled);
  const allRecurringBookings = allBookings.filter(b => b.recurringSeriesId !== null);

  const recurringSeriesSet = new Set<string>();
  allRecurringBookings.forEach(b => {
    if (b.recurringSeriesId) recurringSeriesSet.add(b.recurringSeriesId);
  });

  const overallStats = {
    dateRange: {
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays
    },
    totalRooms: allRooms.length,
    totalBookings: allBookings.length,
    totalActiveBookings: allActive.length,
    totalCancelledBookings: allCancelled.length,
    totalNoShowReleasedBookings: allNoShowReleased.length,
    totalWaitlistConvertedBookings: allWaitlistConverted.length,
    totalVisitors: allVisitors.length,
    totalRecurringBookings: allRecurringBookings.length,
    totalRecurringSeries: recurringSeriesSet.size,
    recurringBookingRate: allBookings.length > 0
      ? Math.round((allRecurringBookings.length / allBookings.length) * 10000) / 100
      : 0,
    overallDailyAverageVisitors: totalDays > 0
      ? Math.round((allVisitors.length / totalDays) * 100) / 100
      : 0,
    overallCancellationRate: allBookings.length > 0
      ? Math.round((allCancelled.length / allBookings.length) * 10000) / 100
      : 0,
    overallEffectiveCancellationRate: allBookings.length > 0
      ? Math.round(((allCancelled.length + allNoShowReleased.length) / allBookings.length) * 10000) / 100
      : 0,
    overallUsageRate: roomStats.length > 0
      ? Math.round((roomStats.reduce((sum, r) => sum + r.usageRate, 0) / roomStats.length) * 100) / 100
      : 0
  };

  return {
    success: true,
    data: {
      summary: overallStats,
      roomStatistics: roomStats.sort((a, b) => b.usageRate - a.usageRate)
    }
  };
}
