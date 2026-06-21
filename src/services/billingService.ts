import prisma from '../prisma';
import { timeToMinutes } from '../utils/time';
import { parse, differenceInMinutes } from 'date-fns';

export const PEAK_RATE_PER_HOUR = 80;
export const OFF_PEAK_RATE_PER_HOUR = 40;
export const LARGE_ROOM_MULTIPLIER = 2;
export const LARGE_ROOM_CAPACITY_THRESHOLD = 10;

export interface CostBreakdown {
  peakMinutes: number;
  offPeakMinutes: number;
  peakHoursCost: number;
  offPeakHoursCost: number;
  totalCost: number;
  isLargeRoom: boolean;
}

export function isLargeRoom(capacity: number): boolean {
  return capacity >= LARGE_ROOM_CAPACITY_THRESHOLD;
}

export function getRatePerHour(isLarge: boolean, isPeak: boolean): number {
  const baseRate = isPeak ? PEAK_RATE_PER_HOUR : OFF_PEAK_RATE_PER_HOUR;
  return isLarge ? baseRate * LARGE_ROOM_MULTIPLIER : baseRate;
}

export function isPeakMinute(minuteOfDay: number): boolean {
  const peak1Start = timeToMinutes('09:00');
  const peak1End = timeToMinutes('12:00');
  const peak2Start = timeToMinutes('14:00');
  const peak2End = timeToMinutes('18:00');
  return (minuteOfDay >= peak1Start && minuteOfDay < peak1End) ||
         (minuteOfDay >= peak2Start && minuteOfDay < peak2End);
}

export function calculateCost(startTime: string, endTime: string, capacity: number): CostBreakdown {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const isLarge = isLargeRoom(capacity);

  let peakMinutes = 0;
  let offPeakMinutes = 0;

  for (let m = startMin; m < endMin; m++) {
    if (isPeakMinute(m)) {
      peakMinutes++;
    } else {
      offPeakMinutes++;
    }
  }

  const peakRate = getRatePerHour(isLarge, true);
  const offPeakRate = getRatePerHour(isLarge, false);

  const peakHoursCost = (peakMinutes / 60) * peakRate;
  const offPeakHoursCost = (offPeakMinutes / 60) * offPeakRate;
  const totalCost = peakHoursCost + offPeakHoursCost;

  return {
    peakMinutes,
    offPeakMinutes,
    peakHoursCost: Math.round(peakHoursCost * 100) / 100,
    offPeakHoursCost: Math.round(offPeakHoursCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    isLargeRoom: isLarge
  };
}

export function getCancelRefundRate(dateStr: string, startTime: string, cancelTime: Date): number {
  const bookingStart = parse(`${dateStr} ${startTime}`, 'yyyy-MM-dd HH:mm', new Date());
  const diffMinutes = differenceInMinutes(bookingStart, cancelTime);

  if (diffMinutes >= 120) return 1;
  if (diffMinutes >= 60) return 0.5;
  return 0;
}

export function calculateRefund(totalCost: number, dateStr: string, startTime: string, cancelTime: Date): number {
  const rate = getCancelRefundRate(dateStr, startTime, cancelTime);
  return Math.round(totalCost * rate * 100) / 100;
}

export async function createBillingRecord(data: {
  departmentId: string;
  bookingId: string;
  roomId: string;
  roomNumber: string;
  date: string;
  type: string;
  amount: number;
  peakMinutes?: number;
  offPeakMinutes?: number;
  peakHoursCost?: number;
  offPeakHoursCost?: number;
  description?: string;
}) {
  return prisma.billingRecord.create({
    data: {
      departmentId: data.departmentId,
      bookingId: data.bookingId,
      roomId: data.roomId,
      roomNumber: data.roomNumber,
      date: data.date,
      type: data.type,
      amount: data.amount,
      peakMinutes: data.peakMinutes || 0,
      offPeakMinutes: data.offPeakMinutes || 0,
      peakHoursCost: data.peakHoursCost || 0,
      offPeakHoursCost: data.offPeakHoursCost || 0,
      description: data.description
    }
  });
}
