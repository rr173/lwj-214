import { Router, Request, Response } from 'express';
import * as budgetService from '../services/budgetService';
import * as billingService from '../services/billingService';

const router = Router();

router.post('/departments', async (req: Request, res: Response) => {
  try {
    const result = await budgetService.createDepartment(req.body);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/departments', async (req: Request, res: Response) => {
  try {
    const departments = await budgetService.getAllDepartments();
    res.json({ success: true, data: departments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/departments/:id', async (req: Request, res: Response) => {
  try {
    const department = await budgetService.getDepartmentById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, error: '部门不存在' });
    }
    res.json({ success: true, data: department });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/departments/:id/budget', async (req: Request, res: Response) => {
  try {
    const result = await budgetService.updateDepartmentBudget(req.params.id, req.body);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/departments/:id/balance', async (req: Request, res: Response) => {
  try {
    const monthKey = req.query.month as string | undefined;
    const balance = await budgetService.getDepartmentBalance(req.params.id, monthKey);
    if (!balance) {
      return res.status(404).json({ success: false, error: '部门不存在' });
    }
    res.json({ success: true, data: balance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/departments/:id/consumptions', async (req: Request, res: Response) => {
  try {
    const monthKey = req.query.month as string | undefined;
    const details = await budgetService.getDepartmentConsumptionDetails(req.params.id, monthKey);
    res.json({ success: true, data: details });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/ranking/departments', async (req: Request, res: Response) => {
  try {
    const monthKey = req.query.month as string | undefined;
    const ranking = await budgetService.getDepartmentMonthRanking(monthKey);
    res.json({ success: true, data: ranking });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/revenue/rooms', async (req: Request, res: Response) => {
  try {
    const roomNumber = req.query.roomNumber as string | undefined;
    const monthKey = req.query.month as string | undefined;
    const revenue = await budgetService.getRoomMonthRevenue(roomNumber, monthKey);
    res.json({ success: true, data: revenue });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { startTime, endTime, capacity } = req.body;
    if (!startTime || !endTime || capacity === undefined) {
      return res.status(400).json({
        success: false,
        error: '缺少参数: startTime, endTime, capacity'
      });
    }
    const cost = billingService.calculateCost(startTime, endTime, capacity);
    res.json({ success: true, data: cost });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
