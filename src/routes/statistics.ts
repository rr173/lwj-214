import { Router, Request, Response } from 'express';
import * as statisticsService from '../services/statisticsService';

const router = Router();

router.get('/weekly', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const result = await statisticsService.getWeeklyStatistics({
      startDate: startDate as string,
      endDate: endDate as string
    });
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
