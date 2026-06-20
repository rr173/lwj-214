import { Router, Request, Response } from 'express';
import * as conflictDetectionService from '../services/conflictDetectionService';

const router = Router();

router.post('/batch', async (req: Request, res: Response) => {
  try {
    const result = await conflictDetectionService.batchDetectConflicts(req.body);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
