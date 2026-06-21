import prisma from '../prisma';
import { format } from 'date-fns';
import type { Department, BillingRecord } from '@prisma/client';

export interface CreateDepartmentInput {
  name: string;
  monthlyBudget: number;
}

export interface UpdateDepartmentBudgetInput {
  monthlyBudget: number;
}

export interface DepartmentBalance {
  department: Department;
  month: string;
  totalBudget: number;
  totalConsumed: number;
  totalRefunded: number;
  balance: number;
}

export interface DepartmentConsumptionDetail {
  record: BillingRecord;
}

export async function createDepartment(input: CreateDepartmentInput) {
  const existing = await prisma.department.findUnique({ where: { name: input.name } });
  if (existing) {
    return { success: false, errors: [{ field: 'name', message: `部门 ${input.name} 已存在` }] };
  }
  const department = await prisma.department.create({
    data: {
      name: input.name,
      monthlyBudget: input.monthlyBudget
    }
  });
  return { success: true, data: department };
}

export async function getDepartmentById(id: string) {
  return prisma.department.findUnique({ where: { id } });
}

export async function getDepartmentByName(name: string) {
  return prisma.department.findUnique({ where: { name } });
}

export async function getAllDepartments() {
  return prisma.department.findMany({ orderBy: { name: 'asc' } });
}

export async function updateDepartmentBudget(id: string, input: UpdateDepartmentBudgetInput) {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) {
    return { success: false, errors: [{ field: 'id', message: '部门不存在' }] };
  }
  const updated = await prisma.department.update({
    where: { id },
    data: { monthlyBudget: input.monthlyBudget }
  });
  return { success: true, data: updated };
}

export function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7);
}

export function getCurrentMonthKey(): string {
  return format(new Date(), 'yyyy-MM');
}

export async function getDepartmentMonthConsumption(departmentId: string, monthKey: string): Promise<{ totalConsumed: number; totalRefunded: number }> {
  const records = await prisma.billingRecord.findMany({
    where: {
      departmentId,
      date: { gte: `${monthKey}-01`, lte: `${monthKey}-31` }
    }
  });

  let totalConsumed = 0;
  let totalRefunded = 0;

  for (const record of records) {
    if (record.amount > 0) {
      totalConsumed += record.amount;
    } else {
      totalRefunded += Math.abs(record.amount);
    }
  }

  return {
    totalConsumed: Math.round(totalConsumed * 100) / 100,
    totalRefunded: Math.round(totalRefunded * 100) / 100
  };
}

export async function getDepartmentBalance(departmentId: string, monthKey?: string): Promise<DepartmentBalance | null> {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) return null;

  const targetMonth = monthKey || getCurrentMonthKey();
  const { totalConsumed, totalRefunded } = await getDepartmentMonthConsumption(departmentId, targetMonth);

  const balance = Math.round((department.monthlyBudget - totalConsumed + totalRefunded) * 100) / 100;

  return {
    department,
    month: targetMonth,
    totalBudget: department.monthlyBudget,
    totalConsumed,
    totalRefunded,
    balance
  };
}

export async function hasEnoughBalance(departmentId: string, amount: number, monthKey?: string): Promise<boolean> {
  const balanceInfo = await getDepartmentBalance(departmentId, monthKey);
  if (!balanceInfo) return false;
  return balanceInfo.balance >= amount;
}

export async function getDepartmentConsumptionDetails(departmentId: string, monthKey?: string) {
  const targetMonth = monthKey || getCurrentMonthKey();
  return prisma.billingRecord.findMany({
    where: {
      departmentId,
      date: { gte: `${targetMonth}-01`, lte: `${targetMonth}-31` }
    },
    include: {
      booking: {
        select: {
          id: true,
          topic: true,
          bookerName: true,
          startTime: true,
          endTime: true,
          isCancelled: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getDepartmentMonthRanking(monthKey?: string) {
  const targetMonth = monthKey || getCurrentMonthKey();
  const departments = await prisma.department.findMany();

  const ranking = [];
  for (const dept of departments) {
    const { totalConsumed, totalRefunded } = await getDepartmentMonthConsumption(dept.id, targetMonth);
    const netConsumed = Math.round((totalConsumed - totalRefunded) * 100) / 100;
    ranking.push({
      departmentId: dept.id,
      departmentName: dept.name,
      totalBudget: dept.monthlyBudget,
      totalConsumed,
      totalRefunded,
      netConsumed,
      balance: Math.round((dept.monthlyBudget - netConsumed) * 100) / 100
    });
  }

  return ranking.sort((a, b) => b.netConsumed - a.netConsumed);
}

export async function getRoomMonthRevenue(roomNumber?: string, monthKey?: string) {
  const targetMonth = monthKey || getCurrentMonthKey();
  const where: any = {
    date: { gte: `${targetMonth}-01`, lte: `${targetMonth}-31` }
  };
  if (roomNumber) {
    where.roomNumber = roomNumber;
  }

  const records = await prisma.billingRecord.findMany({
    where,
    include: { room: true }
  });

  const roomRevenueMap = new Map<string, {
    roomNumber: string;
    roomName: string;
    totalRevenue: number;
    peakRevenue: number;
    offPeakRevenue: number;
    peakMinutes: number;
    offPeakMinutes: number;
    bookingCount: number;
  }>();

  for (const record of records) {
    if (!roomRevenueMap.has(record.roomNumber)) {
      roomRevenueMap.set(record.roomNumber, {
        roomNumber: record.roomNumber,
        roomName: record.room.name,
        totalRevenue: 0,
        peakRevenue: 0,
        offPeakRevenue: 0,
        peakMinutes: 0,
        offPeakMinutes: 0,
        bookingCount: 0
      });
    }
    const stat = roomRevenueMap.get(record.roomNumber)!;
    if (record.amount > 0) {
      stat.totalRevenue += record.amount;
      stat.peakRevenue += record.peakHoursCost;
      stat.offPeakRevenue += record.offPeakHoursCost;
      stat.peakMinutes += record.peakMinutes;
      stat.offPeakMinutes += record.offPeakMinutes;
      stat.bookingCount++;
    }
  }

  const result = Array.from(roomRevenueMap.values()).map(r => ({
    ...r,
    totalRevenue: Math.round(r.totalRevenue * 100) / 100,
    peakRevenue: Math.round(r.peakRevenue * 100) / 100,
    offPeakRevenue: Math.round(r.offPeakRevenue * 100) / 100
  }));

  return result.sort((a, b) => b.totalRevenue - a.totalRevenue);
}
