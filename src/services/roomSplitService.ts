import prisma from '../prisma';
import { format } from 'date-fns';
import { validateRoomNumber, validateRoomName, validateCapacity, ValidationError } from '../utils/validation';
import { getRoomById, RoomWithFacilities } from './roomService';
import type { MeetingRoom, Facility } from '@prisma/client';

export interface SubRoomInput {
  roomNumber: string;
  name: string;
  capacity: number;
}

export interface SplitRoomInput {
  roomId: string;
  subRooms: SubRoomInput[];
}

export interface SplitResult {
  parentRoom: RoomWithFacilities;
  subRooms: RoomWithFacilities[];
}

function transformRoom(room: MeetingRoom & { facilities: { facility: Facility }[] }): RoomWithFacilities {
  return {
    ...room,
    facilities: room.facilities.map(f => f.facility.name)
  };
}

export async function splitRoom(input: SplitRoomInput) {
  const errors: ValidationError[] = [];

  if (!input.roomId) {
    errors.push({ field: 'roomId', message: '房间ID不能为空' });
  }

  if (!input.subRooms || !Array.isArray(input.subRooms) || input.subRooms.length !== 2) {
    errors.push({ field: 'subRooms', message: '目前只支持拆分成2个子区' });
  } else {
    for (let i = 0; i < input.subRooms.length; i++) {
      const sub = input.subRooms[i];
      const roomNumberErr = validateRoomNumber(sub.roomNumber);
      if (roomNumberErr) {
        errors.push({ ...roomNumberErr, field: `subRooms[${i}].roomNumber` });
      }
      const nameErr = validateRoomName(sub.name);
      if (nameErr) {
        errors.push({ ...nameErr, field: `subRooms[${i}].name` });
      }
      const capacityErr = validateCapacity(sub.capacity);
      if (capacityErr) {
        errors.push({ ...capacityErr, field: `subRooms[${i}].capacity` });
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const parentRoom = await prisma.meetingRoom.findUnique({
    where: { id: input.roomId },
    include: { facilities: { include: { facility: true } } }
  });

  if (!parentRoom) {
    return { success: false, errors: [{ field: 'roomId', message: '会议室不存在' }] };
  }

  if (parentRoom.splitStatus !== 'normal') {
    return { success: false, errors: [{ field: 'roomId', message: '该会议室当前状态不允许拆分' }] };
  }

  if (!parentRoom.isActive) {
    return { success: false, errors: [{ field: 'roomId', message: '已停用的会议室不能拆分' }] };
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  const existingBookings = await prisma.booking.findMany({
    where: {
      roomId: input.roomId,
      date: { gte: today },
      isCancelled: false
    }
  });

  if (existingBookings.length > 0) {
    return {
      success: false,
      errors: [{
        field: 'roomId',
        message: `该会议室有 ${existingBookings.length} 个未取消的预约，请先处理后再拆分`
      }]
    };
  }

  for (const sub of input.subRooms) {
    const existing = await prisma.meetingRoom.findUnique({
      where: { roomNumber: sub.roomNumber }
    });
    if (existing) {
      return {
        success: false,
        errors: [{ field: 'subRooms', message: `房间编号 ${sub.roomNumber} 已存在` }]
      };
    }
  }

  const totalSubCapacities = input.subRooms.reduce((sum, sub) => sum + sub.capacity, 0);
  if (totalSubCapacities > parentRoom.capacity) {
    return {
      success: false,
      errors: [{ field: 'subRooms', message: `子区总容量(${totalSubCapacities})不能超过父房间容量(${parentRoom.capacity})` }]
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedParent = await tx.meetingRoom.update({
      where: { id: input.roomId },
      data: {
        isActive: false,
        splitStatus: 'split'
      },
      include: { facilities: { include: { facility: true } } }
    });

    const facilityIds = parentRoom.facilities.map(f => f.facilityId);

    const createdSubRooms = [];
    for (const sub of input.subRooms) {
      const subRoom = await tx.meetingRoom.create({
        data: {
          roomNumber: sub.roomNumber,
          name: sub.name,
          capacity: sub.capacity,
          floor: parentRoom.floor,
          isActive: true,
          splitStatus: 'sub',
          parentRoomId: input.roomId,
          facilities: {
            create: facilityIds.map(facilityId => ({
              facility: { connect: { id: facilityId } }
            }))
          }
        },
        include: { facilities: { include: { facility: true } } }
      });
      createdSubRooms.push(subRoom);
    }

    return { parentRoom: updatedParent, subRooms: createdSubRooms };
  });

  return {
    success: true,
    data: {
      parentRoom: transformRoom(result.parentRoom),
      subRooms: result.subRooms.map(transformRoom)
    }
  };
}

export async function mergeRoom(roomId: string) {
  const errors: ValidationError[] = [];

  if (!roomId) {
    errors.push({ field: 'roomId', message: '房间ID不能为空' });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const room = await prisma.meetingRoom.findUnique({
    where: { id: roomId },
    include: {
      subRooms: {
        include: { facilities: { include: { facility: true } } }
      }
    }
  });

  if (!room) {
    return { success: false, errors: [{ field: 'roomId', message: '会议室不存在' }] };
  }

  let parentRoom: typeof room;
  let subRooms: typeof room.subRooms;

  if (room.splitStatus === 'sub' && room.parentRoomId) {
    const parent = await prisma.meetingRoom.findUnique({
      where: { id: room.parentRoomId },
      include: {
        subRooms: {
          include: { facilities: { include: { facility: true } } }
        }
      }
    });
    if (!parent) {
      return { success: false, errors: [{ field: 'roomId', message: '父房间不存在' }] };
    }
    parentRoom = parent;
    subRooms = parent.subRooms;
  } else if (room.splitStatus === 'split') {
    parentRoom = room;
    subRooms = room.subRooms;
  } else {
    return { success: false, errors: [{ field: 'roomId', message: '该会议室不是拆分状态，无法合并' }] };
  }

  if (subRooms.length === 0) {
    return { success: false, errors: [{ field: 'roomId', message: '没有找到子区需要合并' }] };
  }

  const subRoomIds = subRooms.map(sr => sr.id);
  const today = format(new Date(), 'yyyy-MM-dd');

  const subRoomBookings = await prisma.booking.findMany({
    where: {
      roomId: { in: subRoomIds },
      date: { gte: today },
      isCancelled: false
    }
  });

  if (subRoomBookings.length > 0) {
    return {
      success: false,
      errors: [{
        field: 'roomId',
        message: `子区中有 ${subRoomBookings.length} 个未取消的预约，请先处理后再合并`
      }]
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const subRoom of subRooms) {
      await tx.roomFacility.deleteMany({
        where: { roomId: subRoom.id }
      });
      await tx.booking.deleteMany({
        where: { roomId: subRoom.id }
      });
      await tx.waitlist.deleteMany({
        where: { roomId: subRoom.id }
      });
      await tx.meetingRoom.delete({
        where: { id: subRoom.id }
      });
    }

    const updatedParent = await tx.meetingRoom.update({
      where: { id: parentRoom.id },
      data: {
        isActive: true,
        splitStatus: 'normal'
      },
      include: { facilities: { include: { facility: true } } }
    });

    return updatedParent;
  });

  return {
    success: true,
    data: {
      parentRoom: transformRoom(result)
    }
  };
}

export async function getSubRooms(parentRoomId: string) {
  const subRooms = await prisma.meetingRoom.findMany({
    where: { parentRoomId, splitStatus: 'sub' },
    include: { facilities: { include: { facility: true } } },
    orderBy: { roomNumber: 'asc' }
  });

  return subRooms.map(transformRoom);
}

export async function getParentRoom(subRoomId: string) {
  const subRoom = await prisma.meetingRoom.findUnique({
    where: { id: subRoomId }
  });

  if (!subRoom || !subRoom.parentRoomId) {
    return null;
  }

  const parentRoom = await prisma.meetingRoom.findUnique({
    where: { id: subRoom.parentRoomId },
    include: { facilities: { include: { facility: true } } }
  });

  return parentRoom ? transformRoom(parentRoom) : null;
}
