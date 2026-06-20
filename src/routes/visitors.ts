import { Router, Request, Response } from 'express';
import * as visitorService from '../services/visitorService';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const result = await visitorService.registerVisitor(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/checkin', async (req: Request, res: Response) => {
  try {
    const { checkInCode } = req.body;
    const result = await visitorService.visitorCheckIn(checkInCode);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/booking/:bookingId', async (req: Request, res: Response) => {
  try {
    const visitors = await visitorService.getVisitorsByBookingId(req.params.bookingId);
    res.json({ success: true, data: visitors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/date/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const status = req.query.status as string | undefined;
    const visitors = await visitorService.getVisitorsByDate(date, status);
    res.json({ success: true, data: visitors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/host/:hostName', async (req: Request, res: Response) => {
  try {
    const visitors = await visitorService.getVisitorsByHostName(req.params.hostName);
    res.json({ success: true, data: visitors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const visitor = await visitorService.getVisitorById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, error: '访客记录不存在' });
    }
    res.json({ success: true, data: visitor });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
