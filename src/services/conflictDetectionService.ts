import prisma from '../prisma';
import { isTimeOverlap, getOverlapTimeRange } from '../utils/time';
import {
  validateDate, validateTimeRange, validateAttendeeCount,
  validateBookerName, validateTopic, ValidationError
} from '../utils/validation';
import { getRoomByNumber } from './roomService';
import type { Booking } from '@prisma/client';

export interface BatchBookingRequest {
  bookerName: string;
  roomNumber: string;
  date: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  topic: string;
}

export interface ConflictPair {
  requestIndex1: number;
  requestIndex2: number;
  conflictType: 'BATCH_INTERNAL' | 'WITH_EXISTING';
  roomNumber: string;
  overlapStart: string;
  overlapEnd: string;
  details: string;
}

interface ValidatedRequest extends BatchBookingRequest {
  index: number;
  roomId: string;
  capacity: number;
  errors: ValidationError[];
}

export async function batchDetectConflicts(requests: BatchBookingRequest[]) {
  if (!Array.isArray(requests)) {
    return {
      success: false,
      errors: [{ field: 'requests', message: '请求必须是数组' }]
    };
  }

  if (requests.length === 0) {
    return {
      success: false,
      errors: [{ field: 'requests', message: '请求数组不能为空' }]
    };
  }

  if (requests.length > 20) {
    return {
      success: false,
      errors: [{ field: 'requests', message: '最多只能检测20条请求' }]
    };
  }

  const validatedRequests: ValidatedRequest[] = [];
  const allErrors: { requestIndex: number; errors: ValidationError[] }[] = [];

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    const errors: ValidationError[] = [];

    const bookerErr = validateBookerName(req.bookerName);
    if (bookerErr) errors.push(bookerErr);

    const topicErr = validateTopic(req.topic);
    if (topicErr) errors.push(topicErr);

    const dateErr = validateDate(req.date);
    if (dateErr) errors.push(dateErr);

    const timeErrors = validateTimeRange(req.startTime, req.endTime, req.date);
    errors.push(...timeErrors);

    let roomId = '';
    let capacity = 0;

    const room = await getRoomByNumber(req.roomNumber);
    if (!room) {
      errors.push({ field: 'roomNumber', message: `会议室 ${req.roomNumber} 不存在` });
    } else if (!room.isActive) {
      errors.push({ field: 'roomNumber', message: `会议室 ${req.roomNumber} 已停用` });
    } else {
      roomId = room.id;
      capacity = room.capacity;
      const attendeeErr = validateAttendeeCount(req.attendeeCount, room.capacity);
      if (attendeeErr) errors.push(attendeeErr);
    }

    if (errors.length > 0) {
      allErrors.push({ requestIndex: i, errors });
    }

    validatedRequests.push({
      ...req,
      index: i,
      roomId,
      capacity,
      errors
    });
  }

  if (allErrors.length > 0) {
    return {
      success: false,
      validationErrors: allErrors,
      message: '部分请求参数验证失败，请先修正'
    };
  }

  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < validatedRequests.length; i++) {
    for (let j = i + 1; j < validatedRequests.length; j++) {
      const r1 = validatedRequests[i];
      const r2 = validatedRequests[j];

      if (r1.date === r2.date && r1.roomId === r2.roomId) {
        if (isTimeOverlap(r1.startTime, r1.endTime, r2.startTime, r2.endTime)) {
          const overlap = getOverlapTimeRange(r1.startTime, r1.endTime, r2.startTime, r2.endTime);
          if (overlap) {
            conflicts.push({
              requestIndex1: i,
              requestIndex2: j,
              conflictType: 'BATCH_INTERNAL',
              roomNumber: r1.roomNumber,
              overlapStart: overlap.start,
              overlapEnd: overlap.end,
              details: `请求${i + 1}("${r1.topic}")与请求${j + 1}("${r2.topic}")在房间${r1.roomNumber}冲突`
            });
          }
        }
      }

      if (r1.date === r2.date && r1.bookerName === r2.bookerName) {
        if (isTimeOverlap(r1.startTime, r1.endTime, r2.startTime, r2.endTime)) {
          const overlap = getOverlapTimeRange(r1.startTime, r1.endTime, r2.startTime, r2.endTime);
          if (overlap) {
            conflicts.push({
              requestIndex1: i,
              requestIndex2: j,
              conflictType: 'BATCH_INTERNAL',
              roomNumber: `${r1.roomNumber}/${r2.roomNumber}`,
              overlapStart: overlap.start,
              overlapEnd: overlap.end,
              details: `同一预约人"${r1.bookerName}"在请求${i + 1}和请求${j + 1}中时间段冲突`
            });
          }
        }
      }
    }
  }

  for (let i = 0; i < validatedRequests.length; i++) {
    const req = validatedRequests[i];

    const existingBookings = await prisma.booking.findMany({
      where: {
        roomId: req.roomId,
        date: req.date,
        isCancelled: false
      }
    });

    for (const existing of existingBookings) {
      if (isTimeOverlap(req.startTime, req.endTime, existing.startTime, existing.endTime)) {
        const overlap = getOverlapTimeRange(req.startTime, req.endTime, existing.startTime, existing.endTime);
        if (overlap) {
          conflicts.push({
            requestIndex1: i,
            requestIndex2: -1,
            conflictType: 'WITH_EXISTING',
            roomNumber: req.roomNumber,
            overlapStart: overlap.start,
            overlapEnd: overlap.end,
            details: `请求${i + 1}("${req.topic}")与已有预约"${existing.topic}"(${existing.bookerName})冲突`
          });
        }
      }
    }

    const userBookings = await prisma.booking.findMany({
      where: {
        bookerName: req.bookerName,
        date: req.date,
        isCancelled: false
      }
    });

    for (const existing of userBookings) {
      if (isTimeOverlap(req.startTime, req.endTime, existing.startTime, existing.endTime)) {
        const overlap = getOverlapTimeRange(req.startTime, req.endTime, existing.startTime, existing.endTime);
        if (overlap && existing.roomNumber !== req.roomNumber) {
          conflicts.push({
            requestIndex1: i,
            requestIndex2: -1,
            conflictType: 'WITH_EXISTING',
            roomNumber: `${req.roomNumber}/${existing.roomNumber}`,
            overlapStart: overlap.start,
            overlapEnd: overlap.end,
            details: `请求${i + 1}与预约人"${req.bookerName}"的已有预约"${existing.topic}"(${existing.roomNumber})时间冲突`
          });
        }
      }
    }
  }

  const uniqueConflicts = conflicts.filter((conflict, index, self) =>
    index === self.findIndex(c =>
      c.requestIndex1 === conflict.requestIndex1 &&
      c.requestIndex2 === conflict.requestIndex2 &&
      c.overlapStart === conflict.overlapStart &&
      c.overlapEnd === conflict.overlapEnd &&
      c.conflictType === conflict.conflictType
    )
  );

  return {
    success: true,
    data: {
      totalRequests: requests.length,
      conflictCount: uniqueConflicts.length,
      conflicts: uniqueConflicts
    }
  };
}
