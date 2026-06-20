import { Router, Request, Response } from 'express';
import * as waitlistService from '../services/waitlistService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await waitlistService.createWaitlist(req.body);
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
    const filters: any = {};
    if (req.query.roomNumber) filters.roomNumber = req.query.roomNumber as string;
    if (req.query.date) filters.date = req.query.date as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.bookerName) filters.bookerName = req.query.bookerName as string;

    const data = await waitlistService.getWaitlistList(filters);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/logs/:date', async (req: Request, res: Response) => {
  try {
    const data = await waitlistService.getDailyLogs(req.params.date);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await waitlistService.getWaitlistById(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: '候补记录不存在' });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const result = await waitlistService.cancelWaitlist(req.params.id);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
