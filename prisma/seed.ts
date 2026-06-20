import { PrismaClient } from '@prisma/client';
import { format, addDays } from 'date-fns';

const prisma = new PrismaClient();

const today = format(new Date(), 'yyyy-MM-dd');
const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

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
}

const rooms: SeedRoom[] = [
  { roomNumber: 'S101', name: '小型会议室1', capacity: 4, floor: 1, facilities: ['白板'] },
  { roomNumber: 'S102', name: '小型会议室2', capacity: 4, floor: 1, facilities: ['白板'] },
  { roomNumber: 'M201', name: '中型会议室1', capacity: 8, floor: 2, facilities: ['投影仪', '白板'] },
  { roomNumber: 'M202', name: '中型会议室2', capacity: 8, floor: 2, facilities: ['投影仪', '白板'] },
  { roomNumber: 'L301', name: '大型会议室', capacity: 20, floor: 3, facilities: ['投影仪', '白板', '视频会议系统', '电话会议'] }
];

const bookings: SeedBooking[] = [
  { bookerName: '张三', roomNumber: 'S101', date: today, startTime: '09:00', endTime: '10:00', attendeeCount: 3, topic: '项目周会' },
  { bookerName: '李四', roomNumber: 'S101', date: today, startTime: '10:00', endTime: '11:00', attendeeCount: 2, topic: '一对一沟通' },
  { bookerName: '王五', roomNumber: 'S102', date: today, startTime: '09:30', endTime: '10:30', attendeeCount: 4, topic: '需求评审' },
  { bookerName: '赵六', roomNumber: 'M201', date: today, startTime: '10:00', endTime: '12:00', attendeeCount: 6, topic: '架构设计讨论' },
  { bookerName: '孙七', roomNumber: 'M201', date: today, startTime: '14:00', endTime: '15:30', attendeeCount: 5, topic: '代码审查' },
  { bookerName: '周八', roomNumber: 'M202', date: today, startTime: '09:00', endTime: '11:00', attendeeCount: 7, topic: '产品发布会准备' },
  { bookerName: '吴九', roomNumber: 'M202', date: today, startTime: '13:00', endTime: '14:00', attendeeCount: 3, topic: '快速同步' },
  { bookerName: '郑十', roomNumber: 'L301', date: today, startTime: '09:00', endTime: '12:00', attendeeCount: 15, topic: '全员大会' },
  { bookerName: '陈十一', roomNumber: 'L301', date: today, startTime: '14:00', endTime: '16:00', attendeeCount: 12, topic: '客户演示' },
  { bookerName: '林十二', roomNumber: 'S101', date: today, startTime: '16:00', endTime: '17:00', attendeeCount: 2, topic: '已取消的会议', isCancelled: true, cancelReason: '时间冲突' },
  { bookerName: '张三', roomNumber: 'S101', date: tomorrow, startTime: '09:00', endTime: '10:00', attendeeCount: 3, topic: '项目跟进' },
  { bookerName: '李四', roomNumber: 'M201', date: tomorrow, startTime: '10:00', endTime: '11:30', attendeeCount: 6, topic: '技术方案评审' },
  { bookerName: '王五', roomNumber: 'M202', date: tomorrow, startTime: '14:00', endTime: '16:00', attendeeCount: 8, topic: '季度总结' },
  { bookerName: '赵六', roomNumber: 'L301', date: tomorrow, startTime: '09:00', endTime: '12:00', attendeeCount: 18, topic: '战略规划会议' },
  { bookerName: '孙七', roomNumber: 'S102', date: tomorrow, startTime: '15:00', endTime: '16:00', attendeeCount: 2, topic: '面试', isCancelled: true, cancelReason: '候选人改期' }
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

  for (const booking of bookings) {
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
      const data: any = {
        bookerName: booking.bookerName,
        roomId,
        roomNumber: booking.roomNumber,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        attendeeCount: booking.attendeeCount,
        topic: booking.topic
      };

      if (booking.isCancelled) {
        data.isCancelled = true;
        data.cancelledAt = new Date();
        data.cancelReason = booking.cancelReason;
      }

      await prisma.booking.create({ data });
      console.log(`创建预约: ${booking.date} ${booking.startTime}-${booking.endTime} ${booking.roomNumber} ${booking.topic}${booking.isCancelled ? ' (已取消)' : ''}`);
    } else {
      console.log(`预约已存在: ${booking.date} ${booking.startTime}-${booking.endTime} ${booking.roomNumber}`);
    }
  }

  console.log('\n预置数据完成！');
  console.log(`会议室数量: ${rooms.length}`);
  console.log(`预约记录数量: ${bookings.length}`);
  console.log(`\n今日(${today})预约: ${bookings.filter(b => b.date === today).length}条`);
  console.log(`明日(${tomorrow})预约: ${bookings.filter(b => b.date === tomorrow).length}条`);
  console.log(`已取消预约: ${bookings.filter(b => b.isCancelled).length}条`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
