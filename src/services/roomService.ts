import prisma from '../prisma';
import { validateRoomNumber, validateRoomName, validateCapacity, validateFloor, validateFacilities, ValidationError } from '../utils/validation';
import type { MeetingRoom, Facility } from '@prisma/client';

export interface RoomWithFacilities extends MeetingRoom {
  facilities: string[];
  splitStatus: string;
  parentRoomId: string | null;
  isUnderMaintenance: boolean;
  maintenanceStartDate: string | null;
}

export interface CreateRoomInput {
  roomNumber: string;
  name: string;
  capacity: number;
  floor: number;
  facilities: string[];
  isActive?: boolean;
}

export interface QueryRoomsInput {
  floor?: number;
  minCapacity?: number;
  maxCapacity?: number;
  facilities?: string[];
  isActive?: boolean;
}

function transformRoom(room: MeetingRoom & { facilities: { facility: Facility }[] }): RoomWithFacilities {
  return {
    ...room,
    facilities: room.facilities.map(f => f.facility.name)
  };
}

async function ensureFacilities(facilityNames: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of facilityNames) {
    let facility = await prisma.facility.findUnique({ where: { name } });
    if (!facility) {
      facility = await prisma.facility.create({ data: { name } });
    }
    ids.push(facility.id);
  }
  return ids;
}

export async function createRoom(input: CreateRoomInput) {
  const errors: ValidationError[] = [];

  const roomNumberErr = validateRoomNumber(input.roomNumber);
  if (roomNumberErr) errors.push(roomNumberErr);

  const nameErr = validateRoomName(input.name);
  if (nameErr) errors.push(nameErr);

  const capacityErr = validateCapacity(input.capacity);
  if (capacityErr) errors.push(capacityErr);

  const floorErr = validateFloor(input.floor);
  if (floorErr) errors.push(floorErr);

  const facilitiesErr = validateFacilities(input.facilities);
  if (facilitiesErr) errors.push(facilitiesErr);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const existingRoom = await prisma.meetingRoom.findUnique({
    where: { roomNumber: input.roomNumber }
  });

  if (existingRoom) {
    return {
      success: false,
      errors: [{ field: 'roomNumber', message: `房间编号 ${input.roomNumber} 已存在` }]
    };
  }

  const facilityIds = await ensureFacilities(input.facilities);

  const room = await prisma.meetingRoom.create({
    data: {
      roomNumber: input.roomNumber,
      name: input.name,
      capacity: input.capacity,
      floor: input.floor,
      isActive: input.isActive !== undefined ? input.isActive : true,
      facilities: {
        create: facilityIds.map(facilityId => ({
          facility: { connect: { id: facilityId } }
        }))
      }
    },
    include: {
      facilities: { include: { facility: true } }
    }
  });

  return { success: true, data: transformRoom(room) };
}

export async function getRoomById(id: string): Promise<RoomWithFacilities | null> {
  const room = await prisma.meetingRoom.findUnique({
    where: { id },
    include: {
      facilities: { include: { facility: true } }
    }
  });
  return room ? transformRoom(room) : null;
}

export async function getRoomByNumber(roomNumber: string): Promise<RoomWithFacilities | null> {
  const room = await prisma.meetingRoom.findUnique({
    where: { roomNumber },
    include: {
      facilities: { include: { facility: true } }
    }
  });
  return room ? transformRoom(room) : null;
}

export async function queryRooms(input: QueryRoomsInput = {}): Promise<RoomWithFacilities[]> {
  const where: any = {};

  if (input.floor !== undefined) {
    where.floor = input.floor;
  }

  if (input.minCapacity !== undefined || input.maxCapacity !== undefined) {
    where.capacity = {};
    if (input.minCapacity !== undefined) {
      where.capacity.gte = input.minCapacity;
    }
    if (input.maxCapacity !== undefined) {
      where.capacity.lte = input.maxCapacity;
    }
  }

  if (input.isActive !== undefined) {
    where.isActive = input.isActive;
  }

  let rooms = await prisma.meetingRoom.findMany({
    where,
    include: {
      facilities: { include: { facility: true } }
    },
    orderBy: [{ floor: 'asc' }, { capacity: 'asc' }]
  });

  if (input.facilities && input.facilities.length > 0) {
    rooms = rooms.filter(room => {
      const roomFacilities = room.facilities.map(f => f.facility.name);
      return input.facilities!.every(f => roomFacilities.includes(f));
    });
  }

  return rooms.map(transformRoom);
}

export async function updateRoom(id: string, input: Partial<CreateRoomInput>) {
  const errors: ValidationError[] = [];

  if (input.roomNumber !== undefined) {
    const err = validateRoomNumber(input.roomNumber);
    if (err) errors.push(err);
  }
  if (input.name !== undefined) {
    const err = validateRoomName(input.name);
    if (err) errors.push(err);
  }
  if (input.capacity !== undefined) {
    const err = validateCapacity(input.capacity);
    if (err) errors.push(err);
  }
  if (input.floor !== undefined) {
    const err = validateFloor(input.floor);
    if (err) errors.push(err);
  }
  if (input.facilities !== undefined) {
    const err = validateFacilities(input.facilities);
    if (err) errors.push(err);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  if (input.roomNumber) {
    const existingRoom = await prisma.meetingRoom.findUnique({
      where: { roomNumber: input.roomNumber }
    });
    if (existingRoom && existingRoom.id !== id) {
      return {
        success: false,
        errors: [{ field: 'roomNumber', message: `房间编号 ${input.roomNumber} 已存在` }]
      };
    }
  }

  const updateData: any = {};
  if (input.roomNumber !== undefined) updateData.roomNumber = input.roomNumber;
  if (input.name !== undefined) updateData.name = input.name;
  if (input.capacity !== undefined) updateData.capacity = input.capacity;
  if (input.floor !== undefined) updateData.floor = input.floor;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  if (input.facilities !== undefined) {
    const facilityIds = await ensureFacilities(input.facilities);
    updateData.facilities = {
      deleteMany: {},
      create: facilityIds.map(facilityId => ({
        facility: { connect: { id: facilityId } }
      }))
    };
  }

  const room = await prisma.meetingRoom.update({
    where: { id },
    data: updateData,
    include: {
      facilities: { include: { facility: true } }
    }
  });

  return { success: true, data: transformRoom(room) };
}

export async function setRoomActive(id: string, isActive: boolean): Promise<RoomWithFacilities> {
  const room = await prisma.meetingRoom.update({
    where: { id },
    data: { isActive },
    include: {
      facilities: { include: { facility: true } }
    }
  });
  return transformRoom(room);
}
