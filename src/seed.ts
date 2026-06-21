import { PrismaClient } from '@prisma/client';
import { format, addDays, subMinutes, addMinutes, subDays, subHours } from 'date-fns';
import { calculateCost } from './services/billingService';

const prisma = new PrismaClient();

const today = format(new Date(), 'yyyy-MM-dd');
const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

const departments = [
  { name: '技术部', monthlyBudget: 5000 },
  { name: '产品部', monthlyBudget: 3000 },
  { name: '行政部', monthlyBudget: 2000 }
];

const bookerToDepartment: Record<string, string> = {
  '张三': '技术部',
  '李四': '技术部',
  '王五': '技术部',
  '赵六': '技术部',
  '孙七': '产品部',
  '周八': '产品部',
  '吴九': '产品部',
  '林十二': '产品部',
  '钱一': '行政部',
  '钱二': '行政部',
  '孙三': '行政部',
  '候补演示-张伟': '技术部',
  '未签到演示-刘芳': '产品部',
  '候补人-陈静': '技术部',
  '候补人-何强': '产品部',
  '候补人-许洋': '行政部'
};

interface SeedRoom {
  roomNumber: string;
  name: string;
  capacity: number;
  floor: number;
  facilities: string[];
}

interface SeedBooking {
  bookerName: string;
  roomNumber: string;
  date: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  topic: string;
  isCancelled?: boolean;
  cancelReason?: string;
  isReleased?: boolean;
  checkInTime?: Date | null;
}

interface SeedWaitlist {
  bookerName: string;
  roomNumber: string;
  date: string;
  startTime: string;
  endTime: string;
  attendeeCount: number;
  requiredFacilities: string[];
  topic: string;
  status: string;
  convertedAt?: Date | null;
  convertedSource?: string | null;
  convertedBookingId?: string | null;
}

interface SeedVisitor {
  visitorName: string;
  phoneLastFour: string;
  visitReason: string;
  hostName: string;
  bookingTopic: string;
  bookingDate: string;
  bookingStartTime: string;
  bookingEndTime: string;
  status: 'pending' | 'checked_in' | 'invalidated';
  checkInCode: string;
  checkInTime?: Date | null;
  invalidatedReason?: string | null;
}

interface SeedBookingLog {
  date: string;
  type: string;
  description: string;
  bookingId?: string | null;
  waitlistId?: string | null;
}

const rooms: SeedRoom[] = [
  { roomNumber: 'S101', name: '小型会议室1', capacity: 4, floor: 1, facilities: ['白板'] },
  { roomNumber: 'S102', name: '小型会议室2', capacity: 4, floor: 1, facilities: ['白板'] },
  { roomNumber: 'M201', name: '中型会议室1', capacity: 8, floor: 2, facilities: ['投影仪', '白板'] },
  { roomNumber: 'M202', name: '中型会议室2', capacity: 8, floor: 2, facilities: ['投影仪', '白板'] },
  { roomNumber: 'L301', name: '大型会议室(已拆分)', capacity: 20, floor: 3, facilities: ['投影仪', '白板', '视频会议系统', '电话会议'] },
  { roomNumber: 'L301-A', name: '大型会议室A区', capacity: 10, floor: 3, facilities: ['投影仪', '白板', '视频会议系统', '电话会议'] },
  { roomNumber: 'L301-B', name: '大型会议室B区', capacity: 10, floor: 3, facilities: ['投影仪', '白板', '视频会议系统', '电话会议'] }
];

const bookings: SeedBooking[] = [
  { bookerName: '张三', roomNumber: 'S101', date: today, startTime: '09:00', endTime: '10:00', attendeeCount: 3, topic: '项目周会' },
  { bookerName: '李四', roomNumber: 'S101', date: today, startTime: '10:00', endTime: '11:00', attendeeCount: 2, topic: '一对一沟通' },
  { bookerName: '王五', roomNumber: 'S102', date: today, startTime: '09:30', endTime: '10:30', attendeeCount: 4, topic: '需求评审' },
  { bookerName: '赵六', roomNumber: 'M201', date: today, startTime: '10:00', endTime: '12:00', attendeeCount: 6, topic: '架构设计讨论' },
  { bookerName: '孙七', roomNumber: 'M201', date: today, startTime: '14:00', endTime: '15:30', attendeeCount: 5, topic: '代码审查' },
  { bookerName: '周八', roomNumber: 'M202', date: today, startTime: '09:00', endTime: '11:00', attendeeCount: 7, topic: '产品发布会准备' },
  { bookerName: '吴九', roomNumber: 'M202', date: today, startTime: '13:00', endTime: '14:00', attendeeCount: 3, topic: '快速同步' },
  { bookerName: '林十二', roomNumber: 'S101', date: today, startTime: '16:00', endTime: '17:00', attendeeCount: 2, topic: '已取消的会议', isCancelled: true, cancelReason: '时间冲突' },
  { bookerName: '张三', roomNumber: 'S101', date: tomorrow, startTime: '09:00', endTime: '10:00', attendeeCount: 3, topic: '项目跟进' },
  { bookerName: '李四', roomNumber: 'M201', date: tomorrow, startTime: '10:00', endTime: '11:30', attendeeCount: 6, topic: '技术方案评审' },
  { bookerName: '王五', roomNumber: 'M202', date: tomorrow, startTime: '14:00', endTime: '16:00', attendeeCount: 8, topic: '季度总结' },
  { bookerName: '孙七', roomNumber: 'S102', date: tomorrow, startTime: '15:00', endTime: '16:00', attendeeCount: 2, topic: '面试', isCancelled: true, cancelReason: '候选人改期' },
  { bookerName: '钱一', roomNumber: 'L301-A', date: tomorrow, startTime: '09:00', endTime: '10:30', attendeeCount: 8, topic: '产品评审会' },
  { bookerName: '钱二', roomNumber: 'L301-A', date: tomorrow, startTime: '14:00', endTime: '16:00', attendeeCount: 6, topic: '技术分享会' },
  { bookerName: '孙三', roomNumber: 'L301-B', date: tomorrow, startTime: '10:00', endTime: '11:30', attendeeCount: 7, topic: '项目启动会' },
  { bookerName: '李四', roomNumber: 'L301-B', date: tomorrow, startTime: '15:00', endTime: '17:00', attendeeCount: 9, topic: '客户沟通会' },
];

const demoBookings: SeedBooking[] = [
  {
    bookerName: '候补演示-张伟',
    roomNumber: 'S102',
    date: tomorrow,
    startTime: '09:00',
    endTime: '10:00',
    attendeeCount: 3,
    topic: '候补转正演示-原预约',
    isCancelled: true,
    cancelReason: '临时出差'
  },
  {
    bookerName: '未签到演示-刘芳',
    roomNumber: 'S101',
    date: today,
    startTime: format(addMinutes(new Date(), -30), 'HH:mm').split('.')[0].length >= 5 ? '08:00' : '08:00',
    endTime: '09:00',
    attendeeCount: 2,
    topic: '未签到释放演示-此预约已超时未签到',
    isReleased: true,
    isCancelled: true,
    checkInTime: null
  },
];

const demoWaitlists: SeedWaitlist[] = [
  {
    bookerName: '候补人-陈静',
    roomNumber: 'S102',
    date: tomorrow,
    startTime: '09:00',
    endTime: '10:00',
    attendeeCount: 3,
    requiredFacilities: ['白板'],
    topic: '候补转正演示-候补人',
    status: 'converted',
    convertedAt: new Date(),
    convertedSource: '预约取消'
  },
  {
    bookerName: '候补人-何强',
    roomNumber: 'S101',
    date: today,
    startTime: '08:00',
    endTime: '09:00',
    attendeeCount: 2,
    requiredFacilities: [],
    topic: '未签到释放后补位演示-候补人',
    status: 'converted',
    convertedAt: new Date(),
    convertedSource: '未签到释放'
  },
  {
    bookerName: '候补人-许洋',
    roomNumber: 'M201',
    date: tomorrow,
    startTime: '16:00',
    endTime: '17:00',
    attendeeCount: 5,
    requiredFacilities: ['投影仪'],
    topic: '待补位-项目复盘',
    status: 'pending'
  },
];

const demoVisitors: SeedVisitor[] = [
  {
    visitorName: '客户代表-王总',
    phoneLastFour: '8888',
    visitReason: '项目合作洽谈',
    hostName: '张三',
    bookingTopic: '项目周会',
    bookingDate: today,
    bookingStartTime: '09:00',
    bookingEndTime: '10:00',
    status: 'checked_in',
    checkInCode: '123456',
    checkInTime: new Date()
  },
  {
    visitorName: '面试者-李明',
    phoneLastFour: '6666',
    visitReason: '技术面试',
    hostName: '张三',
    bookingTopic: '项目跟进',
    bookingDate: tomorrow,
    bookingStartTime: '09:00',
    bookingEndTime: '10:00',
    status: 'pending',
    checkInCode: '654321'
  },
  {
    visitorName: '供应商-陈经理',
    phoneLastFour: '9999',
    visitReason: '设备维护',
    hostName: '林十二',
    bookingTopic: '已取消的会议',
    bookingDate: today,
    bookingStartTime: '16:00',
    bookingEndTime: '17:00',
    status: 'invalidated',
    checkInCode: '111111',
    invalidatedReason: '关联预约已取消'
  }
];

async function ensureFacility(name: string): Promise<string> {
  let facility = await prisma.facility.findUnique({ where: { name } });
  if (!facility) {
    facility = await prisma.facility.create({ data: { name } });
    console.log(`创建设施标签: ${name}`);
  }
  return facility.id;
}

async function main() {
  console.log('开始预置数据...');

  for (const room of rooms) {
    const existing = await prisma.meetingRoom.findUnique({
      where: { roomNumber: room.roomNumber }
    });
    if (!existing) {
      const facilityIds = await Promise.all(room.facilities.map(ensureFacility));
      await prisma.meetingRoom.create({
        data: {
          roomNumber: room.roomNumber,
          name: room.name,
          capacity: room.capacity,
          floor: room.floor,
          facilities: {
            create: facilityIds.map(facilityId => ({
              facility: { connect: { id: facilityId } }
            }))
          }
        }
      });
      console.log(`创建会议室: ${room.roomNumber} - ${room.name} (${room.facilities.join(', ')})`);
    } else {
      console.log(`会议室已存在: ${room.roomNumber}`);
    }
  }

  const allRooms = await prisma.meetingRoom.findMany();
  const roomMap = new Map(allRooms.map(r => [r.roomNumber, r.id]));

  const l301 = allRooms.find(r => r.roomNumber === 'L301');
  const l301a = allRooms.find(r => r.roomNumber === 'L301-A');
  const l301b = allRooms.find(r => r.roomNumber === 'L301-B');

  if (l301 && l301.splitStatus === 'normal') {
    await prisma.meetingRoom.update({
      where: { id: l301.id },
      data: {
        splitStatus: 'split',
        isActive: false
      }
    });
    console.log('设置 L301 为已拆分状态');
  }

  if (l301 && l301a && l301a.parentRoomId !== l301.id) {
    await prisma.meetingRoom.update({
      where: { id: l301a.id },
      data: {
        splitStatus: 'sub',
        parentRoomId: l301.id
      }
    });
    console.log('设置 L301-A 为 L301 的子区');
  }

  if (l301 && l301b && l301b.parentRoomId !== l301.id) {
    await prisma.meetingRoom.update({
      where: { id: l301b.id },
      data: {
        splitStatus: 'sub',
        parentRoomId: l301.id
      }
    });
    console.log('设置 L301-B 为 L301 的子区');
  }

  for (const dept of departments) {
    const existing = await prisma.department.findUnique({ where: { name: dept.name } });
    if (!existing) {
      await prisma.department.create({ data: dept });
      console.log(`创建部门: ${dept.name} (月预算 ${dept.monthlyBudget}元)`);
    } else {
      console.log(`部门已存在: ${dept.name}`);
    }
  }

  const allDepartments = await prisma.department.findMany();
  const deptMap = new Map(allDepartments.map(d => [d.name, d.id]));

  const allBookings = [...bookings, ...demoBookings];

  const createdBookingIds: { bookingId: string; roomNumber: string; date: string; startTime: string; endTime: string; bookerName: string; topic: string; isReleased: boolean }[] = [];

  for (const booking of allBookings) {
    const roomId = roomMap.get(booking.roomNumber);
    if (!roomId) {
      console.log(`跳过预约，会议室不存在: ${booking.roomNumber}`);
      continue;
    }

    const existing = await prisma.booking.findFirst({
      where: {
        roomNumber: booking.roomNumber,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        topic: booking.topic
      }
    });

    if (!existing) {
      const deptName = bookerToDepartment[booking.bookerName] || '技术部';
      const departmentId = deptMap.get(deptName);
      const room = allRooms.find(r => r.id === roomId);
      const costBreakdown = room
        ? calculateCost(booking.startTime, booking.endTime, room.capacity)
        : { peakMinutes: 0, offPeakMinutes: 0, peakHoursCost: 0, offPeakHoursCost: 0, totalCost: 0, isLargeRoom: false };

      const data: any = {
        bookerName: booking.bookerName,
        departmentId,
        roomId,
        roomNumber: booking.roomNumber,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        attendeeCount: booking.attendeeCount,
        topic: booking.topic,
        totalCost: costBreakdown.totalCost,
        refundedAmount: 0
      };

      if (booking.isCancelled) {
        data.isCancelled = true;
        data.cancelledAt = new Date();
        data.cancelReason = booking.cancelReason || '未指定';
      }

      if (booking.isReleased) {
        data.isReleased = true;
        data.releasedAt = new Date();
        if (!data.cancelReason) {
          data.cancelReason = '未签到自动释放';
        }
      }

      const created = await prisma.booking.create({ data });

      if (departmentId && !booking.isCancelled && !booking.isReleased && costBreakdown.totalCost > 0) {
        await prisma.billingRecord.create({
          data: {
            departmentId,
            bookingId: created.id,
            roomId,
            roomNumber: booking.roomNumber,
            date: booking.date,
            type: 'charge',
            amount: costBreakdown.totalCost,
            peakMinutes: costBreakdown.peakMinutes,
            offPeakMinutes: costBreakdown.offPeakMinutes,
            peakHoursCost: costBreakdown.peakHoursCost,
            offPeakHoursCost: costBreakdown.offPeakHoursCost,
            description: `预置预约扣费: ${booking.topic} (${booking.startTime}-${booking.endTime})`
          }
        });
      }

      createdBookingIds.push({
        bookingId: created.id,
        roomNumber: booking.roomNumber,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        bookerName: booking.bookerName,
        topic: booking.topic,
        isReleased: booking.isReleased || false
      });
      console.log(`创建预约: ${booking.date} ${booking.startTime}-${booking.endTime} ${booking.roomNumber} ${booking.topic} [${deptName}, ${costBreakdown.totalCost}元]${booking.isCancelled ? ' (已取消)' : ''}${booking.isReleased ? ' (已释放)' : ''}`);
    } else {
      createdBookingIds.push({
        bookingId: existing.id,
        roomNumber: booking.roomNumber,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        bookerName: booking.bookerName,
        topic: booking.topic,
        isReleased: booking.isReleased || false
      });
      console.log(`预约已存在: ${booking.date} ${booking.startTime}-${booking.endTime} ${booking.roomNumber}`);
    }
  }

  for (const wl of demoWaitlists) {
    const roomId = roomMap.get(wl.roomNumber);
    if (!roomId) {
      console.log(`跳过候补，会议室不存在: ${wl.roomNumber}`);
      continue;
    }

    const existing = await prisma.waitlist.findFirst({
      where: {
        roomNumber: wl.roomNumber,
        date: wl.date,
        startTime: wl.startTime,
        endTime: wl.endTime,
        bookerName: wl.bookerName,
        topic: wl.topic
      }
    });

    if (!existing) {
      let convertedBookingId: string | null = null;

      if (wl.status === 'converted') {
        const matchingBooking = await prisma.booking.findFirst({
          where: {
            roomNumber: wl.roomNumber,
            date: wl.date,
            startTime: wl.startTime,
            endTime: wl.endTime,
            bookerName: wl.bookerName,
            convertedFromWaitlistId: { not: null }
          }
        });

        if (!matchingBooking) {
          const wlDeptName = bookerToDepartment[wl.bookerName] || '技术部';
          const wlDeptId = deptMap.get(wlDeptName);
          const wlRoom = allRooms.find(r => r.id === roomId);
          const wlCost = wlRoom
            ? calculateCost(wl.startTime, wl.endTime, wlRoom.capacity)
            : { peakMinutes: 0, offPeakMinutes: 0, peakHoursCost: 0, offPeakHoursCost: 0, totalCost: 0, isLargeRoom: false };

          const convertedBooking = await prisma.booking.create({
            data: {
              bookerName: wl.bookerName,
              departmentId: wlDeptId,
              roomId,
              roomNumber: wl.roomNumber,
              date: wl.date,
              startTime: wl.startTime,
              endTime: wl.endTime,
              attendeeCount: wl.attendeeCount,
              topic: wl.topic,
              totalCost: wlCost.totalCost,
              refundedAmount: 0,
              convertedFromWaitlistAt: wl.convertedAt || new Date()
            }
          });
          convertedBookingId = convertedBooking.id;

          if (wlDeptId && wlCost.totalCost > 0) {
            await prisma.billingRecord.create({
              data: {
                departmentId: wlDeptId,
                bookingId: convertedBooking.id,
                roomId,
                roomNumber: wl.roomNumber,
                date: wl.date,
                type: 'charge',
                amount: wlCost.totalCost,
                peakMinutes: wlCost.peakMinutes,
                offPeakMinutes: wlCost.offPeakMinutes,
                peakHoursCost: wlCost.peakHoursCost,
                offPeakHoursCost: wlCost.offPeakHoursCost,
                description: `候补转正扣费: ${wl.topic}`
              }
            });
          }

          console.log(`创建候补转正预约: ${wl.date} ${wl.startTime}-${wl.endTime} ${wl.roomNumber} ${wl.topic} [${wlDeptName}, ${wlCost.totalCost}元]`);
        } else {
          convertedBookingId = matchingBooking.id;
        }
      }

      const waitlist = await prisma.waitlist.create({
        data: {
          bookerName: wl.bookerName,
          roomId,
          roomNumber: wl.roomNumber,
          date: wl.date,
          startTime: wl.startTime,
          endTime: wl.endTime,
          attendeeCount: wl.attendeeCount,
          requiredFacilities: JSON.stringify(wl.requiredFacilities),
          topic: wl.topic,
          status: wl.status,
          convertedAt: wl.convertedAt,
          convertedSource: wl.convertedSource,
          convertedBookingId
        }
      });

      if (wl.status === 'converted' && convertedBookingId) {
        await prisma.booking.update({
          where: { id: convertedBookingId },
          data: { convertedFromWaitlistId: waitlist.id }
        });
      }

      console.log(`创建候补: ${wl.date} ${wl.startTime}-${wl.endTime} ${wl.roomNumber} ${wl.bookerName} [${wl.status}]`);
    } else {
      console.log(`候补已存在: ${wl.date} ${wl.startTime}-${wl.endTime} ${wl.roomNumber} ${wl.bookerName}`);
    }
  }

  const noShowBooking = createdBookingIds.find(b => b.isReleased && b.topic.includes('未签到释放'));
  if (noShowBooking) {
    const existingLog = await prisma.bookingLog.findFirst({
      where: { bookingId: noShowBooking.bookingId, type: 'no_show_release' }
    });
    if (!existingLog) {
      await prisma.bookingLog.create({
        data: {
          date: noShowBooking.date,
          type: 'no_show_release',
          bookingId: noShowBooking.bookingId,
          description: `未签到释放: ${noShowBooking.bookerName} 的预约(${noShowBooking.roomNumber} ${noShowBooking.date} ${noShowBooking.startTime}-${noShowBooking.endTime})因超时未签到自动释放`
        }
      });
      console.log(`创建日志: 未签到释放 - ${noShowBooking.topic}`);
    }
  }

  const cancelBooking = createdBookingIds.find(b => b.topic.includes('候补转正演示-原预约'));
  if (cancelBooking) {
    const existingLog = await prisma.bookingLog.findFirst({
      where: { bookingId: cancelBooking.bookingId, type: 'booking_cancelled' }
    });
    if (!existingLog) {
      await prisma.bookingLog.create({
        data: {
          date: cancelBooking.date,
          type: 'booking_cancelled',
          bookingId: cancelBooking.bookingId,
          description: `预约取消: ${cancelBooking.bookerName} 的预约(${cancelBooking.roomNumber} ${cancelBooking.date} ${cancelBooking.startTime}-${cancelBooking.endTime})被取消，原因: 临时出差`
        }
      });
      console.log(`创建日志: 预约取消 - ${cancelBooking.topic}`);
    }
  }

  const waitlistConvertedLog = await prisma.bookingLog.findFirst({
    where: { type: 'waitlist_converted' }
  });
  if (!waitlistConvertedLog) {
    const convertedWl = await prisma.waitlist.findFirst({
      where: { status: 'converted', convertedSource: '预约取消' }
    });
    const convertedBooking = await prisma.booking.findFirst({
      where: { bookerName: '候补人-陈静', date: tomorrow, startTime: '09:00', endTime: '10:00' }
    });
    if (convertedWl && convertedBooking) {
      await prisma.bookingLog.create({
        data: {
          date: tomorrow,
          type: 'waitlist_converted',
          bookingId: convertedBooking.id,
          waitlistId: convertedWl.id,
          description: `候补转正: 候补人-陈静 的候补(S102 ${tomorrow} 09:00-10:00)因[预约取消]转为正式预约`
        }
      });
      console.log('创建日志: 候补转正 - 候补人-陈静');
    }

    const noShowWl = await prisma.waitlist.findFirst({
      where: { status: 'converted', convertedSource: '未签到释放' }
    });
    const noShowConvertedBooking = await prisma.booking.findFirst({
      where: { bookerName: '候补人-何强' }
    });
    if (noShowWl && noShowConvertedBooking) {
      await prisma.bookingLog.create({
        data: {
          date: today,
          type: 'waitlist_converted',
          bookingId: noShowConvertedBooking.id,
          waitlistId: noShowWl.id,
          description: `候补转正: 候补人-何强 的候补(S101 ${today} 08:00-09:00)因[未签到释放]转为正式预约`
        }
      });
      console.log('创建日志: 候补转正 - 候补人-何强');
    }
  }

  for (const visitor of demoVisitors) {
    const booking = await prisma.booking.findFirst({
      where: {
        topic: visitor.bookingTopic,
        date: visitor.bookingDate,
        startTime: visitor.bookingStartTime,
        endTime: visitor.bookingEndTime,
        bookerName: visitor.hostName
      }
    });

    if (booking) {
      const existingVisitor = await prisma.visitor.findFirst({
        where: {
          visitorName: visitor.visitorName,
          bookingId: booking.id
        }
      });

      if (!existingVisitor) {
        const data: any = {
          visitorName: visitor.visitorName,
          phoneLastFour: visitor.phoneLastFour,
          visitReason: visitor.visitReason,
          hostName: visitor.hostName,
          bookingId: booking.id,
          checkInCode: visitor.checkInCode,
          status: visitor.status,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          roomNumber: booking.roomNumber
        };

        if (visitor.status === 'checked_in' && visitor.checkInTime) {
          data.checkInTime = visitor.checkInTime;
        }

        if (visitor.status === 'invalidated' && visitor.invalidatedReason) {
          data.invalidatedAt = new Date();
          data.invalidatedReason = visitor.invalidatedReason;
        }

        await prisma.visitor.create({ data });
        console.log(`创建访客: ${visitor.visitorName} - ${visitor.hostName} (${visitor.status})`);
      } else {
        console.log(`访客已存在: ${visitor.visitorName}`);
      }
    } else {
      console.log(`跳过访客，关联预约不存在: ${visitor.visitorName} - ${visitor.bookingTopic}`);
    }
  }

  const m201Room = allRooms.find(r => r.roomNumber === 'M201');
  if (m201Room) {
    const existingTickets = await prisma.maintenanceTicket.findMany({
      where: { roomNumber: 'M201' }
    });

    if (existingTickets.length === 0) {
      const historicalTicket = await prisma.maintenanceTicket.create({
        data: {
          roomId: m201Room.id,
          roomNumber: 'M201',
          facilityTag: '白板',
          description: '白板笔书写不流畅，需要更换白板笔和清洁白板',
          reporterName: '孙七',
          urgency: 'normal',
          status: 'closed',
          assignee: '王师傅',
          estimatedFixDate: format(subDays(new Date(), 5), 'yyyy-MM-dd'),
          submittedAt: subDays(new Date(), 7),
          assignedAt: subDays(new Date(), 6),
          completedAt: subDays(new Date(), 5),
          closedAt: subDays(new Date(), 5)
        }
      });
      console.log(`创建历史工单: M201 白板故障 [已关闭]`);

      const activeUrgentTicket = await prisma.maintenanceTicket.create({
        data: {
          roomId: m201Room.id,
          roomNumber: 'M201',
          facilityTag: '投影仪',
          description: '投影仪无法开机，指示灯不亮，疑似电源模块故障',
          reporterName: '赵六',
          urgency: 'urgent',
          status: 'in_repair',
          assignee: '李工程师',
          estimatedFixDate: tomorrow,
          submittedAt: subHours(new Date(), 2),
          assignedAt: subHours(new Date(), 1)
        }
      });
      console.log(`创建紧急工单: M201 投影仪故障 [维修中]`);

      await prisma.meetingRoom.update({
        where: { id: m201Room.id },
        data: {
          isUnderMaintenance: true,
          maintenanceStartDate: today
        }
      });
      console.log(`设置 M201 为维护状态`);

      const todayBookings = await prisma.booking.findMany({
        where: {
          roomId: m201Room.id,
          date: today,
          isCancelled: false,
          isReleased: false
        }
      });

      const now = new Date();
      const nowTime = format(now, 'HH:mm');

      for (const booking of todayBookings) {
        if (booking.startTime > nowTime) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              isCancelled: true,
              cancelledAt: new Date(),
              cancelReason: '设备维护，房间临时关闭'
            }
          });
          console.log(`取消 M201 今日预约: ${booking.topic} (${booking.startTime}-${booking.endTime})`);

          await prisma.bookingLog.create({
            data: {
              date: booking.date,
              type: 'booking_cancelled',
              bookingId: booking.id,
              description: `预约取消: ${booking.bookerName} 的预约(M201 ${booking.date} ${booking.startTime}-${booking.endTime})因设备维护被取消`
            }
          });
        }
      }

      const tomorrowBookings = await prisma.booking.findMany({
        where: {
          roomId: m201Room.id,
          date: { gte: tomorrow },
          isCancelled: false,
          isReleased: false
        }
      });

      for (const booking of tomorrowBookings) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            isCancelled: true,
            cancelledAt: new Date(),
            cancelReason: '设备维护，房间临时关闭'
          }
        });
        console.log(`取消 M201 未来预约: ${booking.topic} (${booking.date} ${booking.startTime}-${booking.endTime})`);

        await prisma.bookingLog.create({
          data: {
            date: booking.date,
            type: 'booking_cancelled',
            bookingId: booking.id,
            description: `预约取消: ${booking.bookerName} 的预约(M201 ${booking.date} ${booking.startTime}-${booking.endTime})因设备维护被取消`
          }
        });
      }

      const affectedWaitlists = await prisma.waitlist.findMany({
        where: {
          roomId: m201Room.id,
          status: 'pending'
        }
      });

      for (const wl of affectedWaitlists) {
        await prisma.waitlist.update({
          where: { id: wl.id },
          data: { status: 'cancelled', updatedAt: new Date() }
        });
        console.log(`取消 M201 候补: ${wl.bookerName} (${wl.date} ${wl.startTime}-${wl.endTime})`);
      }
    } else {
      console.log('维护工单已存在，跳过创建');
    }
  }

  console.log('\n预置数据完成！');
  console.log(`会议室数量: ${rooms.length}`);
  console.log(`预约记录数量: ${allBookings.length}`);
  console.log(`候补记录数量: ${demoWaitlists.length}`);
  console.log(`访客记录数量: ${demoVisitors.length}`);
  console.log(`今日(${today})预约: ${allBookings.filter(b => b.date === today).length}条`);
  console.log(`明日(${tomorrow})预约: ${allBookings.filter(b => b.date === tomorrow).length}条`);
  console.log(`已取消预约: ${allBookings.filter(b => b.isCancelled).length}条`);
  console.log(`已释放预约(未签到): ${allBookings.filter(b => b.isReleased).length}条`);
  console.log(`候补转正: ${demoWaitlists.filter(w => w.status === 'converted').length}条`);
  console.log(`待补位: ${demoWaitlists.filter(w => w.status === 'pending').length}条`);
  console.log(`已签到访客: ${demoVisitors.filter(v => v.status === 'checked_in').length}条`);
  console.log(`待签到访客: ${demoVisitors.filter(v => v.status === 'pending').length}条`);
  console.log(`已失效访客: ${demoVisitors.filter(v => v.status === 'invalidated').length}条`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
