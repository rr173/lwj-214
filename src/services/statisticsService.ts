import prisma from '../prisma';
import { parse, differenceInDays, addDays, format, isAfter, isBefore } from 'date-fns';
import { timeToMinutes, WORK_START, WORK_END } from '../utils/time';
import { isValidDateFormat } from '../utils/time';
import { queryRooms } from './roomService';
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

  const rooms = await queryRooms();
  const allBookings = await prisma.booking.findMany({
    where: {
      date: { gte: input.startDate, lte: input.endDate }
    }
  });

  const totalDays = daysDiff + 1;
  const dailyWorkingMinutes = timeToMinutes(WORK_END) - timeToMinutes(WORK_START);
  const totalWorkingMinutes = totalDays * dailyWorkingMinutes;

  const roomStats: RoomStatistics[] = [];

  for (const room of rooms) {
    const roomBookings = allBookings.filter(b => b.roomId === room.id);
    const activeBookings = roomBookings.filter(b => !b.isCancelled);
    const cancelledBookings = roomBookings.filter(b => b.isCancelled);

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

    const totalBookings = roomBookings.length;
    const cancellationRate = totalBookings > 0 ? (cancelledBookings.length / totalBookings) * 100 : 0;

    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour, count]) => ({ hour, count }));

    roomStats.push({
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
      cancellationRate: Math.round(cancellationRate * 100) / 100
    });
  }

  const overallStats = {
    dateRange: {
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays
    },
    totalRooms: rooms.length,
    totalBookings: allBookings.length,
    totalActiveBookings: allBookings.filter(b => !b.isCancelled).length,
    totalCancelledBookings: allBookings.filter(b => b.isCancelled).length,
    overallCancellationRate: allBookings.length > 0
      ? Math.round((allBookings.filter(b => b.isCancelled).length / allBookings.length) * 10000) / 100
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
