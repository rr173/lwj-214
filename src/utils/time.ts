import { parse, format, addMinutes, differenceInMinutes, isBefore, isAfter, isEqual } from 'date-fns';

export const WORK_START = '08:00';
export const WORK_END = '22:00';
export const MIN_BOOKING_MINUTES = 15;
export const MAX_BOOKING_MINUTES = 240;
export const TIME_GRANULARITY = 15;

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function isValidTimeFormat(time: string): boolean {
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

export function isValidDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function isTimeInWorkingHours(startTime: string, endTime: string): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const workStart = timeToMinutes(WORK_START);
  const workEnd = timeToMinutes(WORK_END);
  return start >= workStart && end <= workEnd;
}

export function isTimeGranularityValid(time: string): boolean {
  const minutes = timeToMinutes(time);
  return minutes % TIME_GRANULARITY === 0;
}

export function getBookingDuration(startTime: string, endTime: string): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

export function isBookingDurationValid(startTime: string, endTime: string): boolean {
  const duration = getBookingDuration(startTime, endTime);
  return duration >= MIN_BOOKING_MINUTES && duration <= MAX_BOOKING_MINUTES;
}

export function isDateInRange(dateStr: string, daysFromNow: number = 30): boolean {
  const date = parse(dateStr, 'yyyy-MM-dd', new Date());
  const today = parse(format(new Date(), 'yyyy-MM-dd'), 'yyyy-MM-dd', new Date());
  const maxDate = addMinutes(today, daysFromNow * 24 * 60);
  return (isAfter(date, today) || isEqual(date, today)) && (isBefore(date, maxDate) || isEqual(date, maxDate));
}

export function isPastDateTime(dateStr: string, timeStr: string): boolean {
  const dateTime = parse(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', new Date());
  return isBefore(dateTime, new Date());
}

export function isTimeOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return s1 < e2 && s2 < e1;
}

export function getOverlapDuration(start1: string, end1: string, start2: string, end2: string): number {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  const overlapStart = Math.max(s1, s2);
  const overlapEnd = Math.min(e1, e2);
  return Math.max(0, overlapEnd - overlapStart);
}

export function getOverlapTimeRange(start1: string, end1: string, start2: string, end2: string): { start: string; end: string } | null {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  const overlapStart = Math.max(s1, s2);
  const overlapEnd = Math.min(e1, e2);
  if (overlapStart >= overlapEnd) return null;
  return {
    start: minutesToTime(overlapStart),
    end: minutesToTime(overlapEnd)
  };
}

export function addTime(time: string, minutes: number): string {
  const total = timeToMinutes(time) + minutes;
  return minutesToTime(Math.max(0, Math.min(24 * 60 - 1, total)));
}
