import { Router, Request, Response } from 'express';
import * as recommendationService from '../services/recommendationService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await recommendationService.getRecommendations(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
