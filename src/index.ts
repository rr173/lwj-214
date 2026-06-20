import express from 'express';
import roomsRouter from './routes/rooms';
import bookingsRouter from './routes/bookings';
import recommendationRouter from './routes/recommendation';
import conflictsRouter from './routes/conflicts';
import statisticsRouter from './routes/statistics';
import waitlistRouter from './routes/waitlist';
import visitorsRouter from './routes/visitors';
import { startScheduler, stopScheduler } from './services/schedulerService';
import prisma from './prisma';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    name: '会议室预约与冲突调度服务',
    version: '2.0.0',
    endpoints: {
      rooms: {
        'POST /api/rooms': '注册会议室',
        'GET /api/rooms': '查询会议室列表（支持筛选）',
        'GET /api/rooms/:id': '根据ID查询会议室',
        'GET /api/rooms/number/:roomNumber': '根据编号查询会议室',
        'PUT /api/rooms/:id': '更新会议室信息',
        'PATCH /api/rooms/:id/active': '启用/停用会议室'
      },
      bookings: {
        'POST /api/bookings': '创建预约',
        'GET /api/bookings/:id': '查询预约详情',
        'GET /api/bookings/room/:roomNumber/:date': '查询某房间某天的预约',
        'GET /api/bookings/range/:startDate/:endDate': '查询日期范围内的预约',
        'PUT /api/bookings/:id': '修改预约',
        'POST /api/bookings/:id/cancel': '取消预约',
        'POST /api/bookings/:id/checkin': '签到'
      },
      waitlist: {
        'POST /api/waitlist': '创建候补',
        'GET /api/waitlist': '候补列表（支持筛选）',
        'GET /api/waitlist/:id': '候补详情',
        'POST /api/waitlist/:id/cancel': '取消候补',
        'GET /api/waitlist/logs/:date': '某天自动释放与补位记录'
      },
      recommendation: {
        'POST /api/recommendation': '智能推荐空闲会议室'
      },
      conflicts: {
        'POST /api/conflicts/batch': '批量冲突检测'
      },
      statistics: {
        'GET /api/statistics/weekly?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD': '周报统计（含未签到释放、候补转正等指标）'
      },
      visitors: {
        'POST /api/visitors/register': '访客登记',
        'POST /api/visitors/checkin': '访客签到（凭签到码）',
        'GET /api/visitors/booking/:bookingId': '查询某个预约的访客列表',
        'GET /api/visitors/date/:date?status=pending|checked_in|invalidated': '查询某天的访客记录（支持按状态筛选）',
        'GET /api/visitors/host/:hostName': '按接待人查询访客',
        'GET /api/visitors/:id': '查询访客详情'
      }
    }
  });
});

app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/recommendation', recommendationRouter);
app.use('/api/conflicts', conflictsRouter);
app.use('/api/statistics', statisticsRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/visitors', visitorsRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

async function startServer() {
  try {
    await prisma.$connect();
    console.log('数据库连接成功');

    startScheduler();

    app.listen(PORT, () => {
      console.log(`服务器运行在 http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGINT', async () => {
  stopScheduler();
  await prisma.$disconnect();
  process.exit(0);
});
