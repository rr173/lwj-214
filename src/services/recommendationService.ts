import prisma from '../prisma';
import { isTimeOverlap, timeToMinutes, minutesToTime, addTime } from '../utils/time';
import { validateDate, validateTimeRange, validateFacilities, validateCapacity, ValidationError } from '../utils/validation';
import { queryRooms, RoomWithFacilities } from './roomService';
import type { Booking } from '@prisma/client';

export interface RecommendationInput {
  date: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  requiredFacilities?: string[];
}

export interface RecommendedRoom {
  room: RoomWithFacilities;
  suggestedStartTime?: string;
  suggestedEndTime?: string;
  isExactMatch: boolean;
  matchScore: number;
  wastedSeats: number;
}

interface AvailableSlot {
  start: string;
  end: string;
}

function getAvailableSlots(bookings: Booking[], startTime: string, endTime: string): AvailableSlot[] {
  const workStart = 8 * 60;
  const workEnd = 22 * 60;
  const reqStart = timeToMinutes(startTime);
  const reqEnd = timeToMinutes(endTime);
  const duration = reqEnd - reqStart;

  const sortedBookings = [...bookings]
    .filter(b => !b.isCancelled)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const slots: AvailableSlot[] = [];
  let currentStart = workStart;

  for (const booking of sortedBookings) {
    const bStart = timeToMinutes(booking.startTime);
    const bEnd = timeToMinutes(booking.endTime);
    if (bStart > currentStart) {
      slots.push({ start: minutesToTime(currentStart), end: minutesToTime(bStart) });
    }
    currentStart = Math.max(currentStart, bEnd);
  }

  if (currentStart < workEnd) {
    slots.push({ start: minutesToTime(currentStart), end: minutesToTime(workEnd) });
  }

  return slots.filter(slot => {
    const sStart = timeToMinutes(slot.start);
    const sEnd = timeToMinutes(slot.end);
    return sEnd - sStart >= duration;
  });
}

function findExactSlot(slots: AvailableSlot[], startTime: string, endTime: string): boolean {
  const reqStart = timeToMinutes(startTime);
  const reqEnd = timeToMinutes(endTime);

  for (const slot of slots) {
    const sStart = timeToMinutes(slot.start);
    const sEnd = timeToMinutes(slot.end);
    if (reqStart >= sStart && reqEnd <= sEnd) {
      return true;
    }
  }
  return false;
}

function findNearbySlots(slots: AvailableSlot[], startTime: string, endTime: string, floatMinutes: number = 30): AvailableSlot | null {
  const reqStart = timeToMinutes(startTime);
  const reqEnd = timeToMinutes(endTime);
  const duration = reqEnd - reqStart;
  const floatStart = reqStart - floatMinutes;
  const floatEnd = reqEnd + floatMinutes;

  let bestSlot: AvailableSlot | null = null;
  let bestDistance = Infinity;

  for (const slot of slots) {
    const sStart = timeToMinutes(slot.start);
    const sEnd = timeToMinutes(slot.end);

    for (let start = Math.max(sStart, floatStart); start + duration <= Math.min(sEnd, floatEnd); start += 15) {
      const distance = Math.abs(start - reqStart);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSlot = { start: minutesToTime(start), end: minutesToTime(start + duration) };
      }
    }
  }

  return bestSlot;
}

function calculateMatchScore(room: RoomWithFacilities, attendeeCount: number, isExactMatch: boolean): number {
  const wastedSeats = room.capacity - attendeeCount;
  const floorScore = room.floor;
  const exactBonus = isExactMatch ? 1000 : 0;
  return exactBonus - (wastedSeats * 10) - (floorScore * 5);
}

export async function getRecommendations(input: RecommendationInput) {
  const errors: ValidationError[] = [];

  const dateErr = validateDate(input.date);
  if (dateErr) errors.push(dateErr);

  const timeErrors = validateTimeRange(input.startTime, input.endTime, input.date);
  errors.push(...timeErrors);

  const capacityErr = validateCapacity(input.attendeeCount);
  if (capacityErr) errors.push(capacityErr);

  if (input.requiredFacilities && input.requiredFacilities.length > 0) {
    const facilitiesErr = validateFacilities(input.requiredFacilities);
    if (facilitiesErr) errors.push(facilitiesErr);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const candidateRooms = await queryRooms({
    minCapacity: input.attendeeCount,
    facilities: input.requiredFacilities,
    isActive: true
  });

  const availableRooms = candidateRooms.filter(room => {
    if (!room.isUnderMaintenance) return true;
    if (!room.maintenanceStartDate) return true;
    return input.date < room.maintenanceStartDate;
  });

  const bookingsByRoom = new Map<string, Booking[]>();
  for (const room of availableRooms) {
    const bookings = await prisma.booking.findMany({
      where: { roomId: room.id, date: input.date, isCancelled: false }
    });
    bookingsByRoom.set(room.id, bookings);
  }

  const exactMatches: RecommendedRoom[] = [];
  const nearMatches: RecommendedRoom[] = [];

  for (const room of availableRooms) {
    const bookings = bookingsByRoom.get(room.id) || [];
    const availableSlots = getAvailableSlots(bookings, input.startTime, input.endTime);

    if (findExactSlot(availableSlots, input.startTime, input.endTime)) {
      exactMatches.push({
        room,
        isExactMatch: true,
        matchScore: calculateMatchScore(room, input.attendeeCount, true),
        wastedSeats: room.capacity - input.attendeeCount
      });
    } else {
      const nearbySlot = findNearbySlots(availableSlots, input.startTime, input.endTime, 30);
      if (nearbySlot) {
        nearMatches.push({
          room,
          suggestedStartTime: nearbySlot.start,
          suggestedEndTime: nearbySlot.end,
          isExactMatch: false,
          matchScore: calculateMatchScore(room, input.attendeeCount, false),
          wastedSeats: room.capacity - input.attendeeCount
        });
      }
    }
  }

  const sortRooms = (a: RecommendedRoom, b: RecommendedRoom) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    if (a.wastedSeats !== b.wastedSeats) {
      return a.wastedSeats - b.wastedSeats;
    }
    return a.room.floor - b.room.floor;
  };

  exactMatches.sort(sortRooms);
  nearMatches.sort(sortRooms);

  return {
    success: true,
    data: {
      exactMatches,
      nearMatches,
      request: {
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        attendeeCount: input.attendeeCount,
        requiredFacilities: input.requiredFacilities || []
      }
    }
  };
}
