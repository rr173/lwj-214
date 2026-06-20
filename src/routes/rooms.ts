import { Router, Request, Response } from 'express';
import * as roomService from '../services/roomService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await roomService.createRoom(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const query = {
      floor: req.query.floor ? parseInt(req.query.floor as string) : undefined,
      minCapacity: req.query.minCapacity ? parseInt(req.query.minCapacity as string) : undefined,
      maxCapacity: req.query.maxCapacity ? parseInt(req.query.maxCapacity as string) : undefined,
      facilities: req.query.facilities ? (req.query.facilities as string).split(',') : undefined,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined
    };
    const rooms = await roomService.queryRooms(query);
    res.json({ success: true, data: rooms });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const room = await roomService.getRoomById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, error: '会议室不存在' });
    }
    res.json({ success: true, data: room });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/number/:roomNumber', async (req: Request, res: Response) => {
  try {
    const room = await roomService.getRoomByNumber(req.params.roomNumber);
    if (!room) {
      return res.status(404).json({ success: false, error: '会议室不存在' });
    }
    res.json({ success: true, data: room });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const result = await roomService.updateRoom(req.params.id, req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id/active', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    if (isActive === undefined || typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        errors: [{ field: 'isActive', message: 'isActive 必须是布尔值' }]
      });
    }
    const room = await roomService.setRoomActive(req.params.id, isActive);
    res.json({ success: true, data: room });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
