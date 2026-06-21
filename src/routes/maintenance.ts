import { Router, Request, Response } from 'express';
import * as maintenanceService from '../services/maintenanceService';

const router = Router();

router.post('/tickets', async (req: Request, res: Response) => {
  try {
    const result = await maintenanceService.createTicket(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/tickets', async (req: Request, res: Response) => {
  try {
    const filters = {
      status: req.query.status as string | undefined,
      urgency: req.query.urgency as string | undefined,
      roomNumber: req.query.roomNumber as string | undefined
    };
    const tickets = await maintenanceService.getAllTickets(filters);
    res.json({ success: true, data: tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/tickets/:id', async (req: Request, res: Response) => {
  try {
    const ticket = await maintenanceService.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: '工单不存在' });
    }
    res.json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/tickets/room/:roomNumber', async (req: Request, res: Response) => {
  try {
    const tickets = await maintenanceService.getTicketsByRoom(req.params.roomNumber);
    res.json({ success: true, data: tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/tickets/:id/assign', async (req: Request, res: Response) => {
  try {
    const result = await maintenanceService.assignTicket({
      ticketId: req.params.id,
      personId: req.body.personId,
      estimatedFixDate: req.body.estimatedFixDate,
      estimatedStartTime: req.body.estimatedStartTime,
      estimatedEndTime: req.body.estimatedEndTime
    });
    if (!result.success) {
      if (result.conflicts) {
        return res.status(409).json(result);
      }
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/tickets/:id/complete', async (req: Request, res: Response) => {
  try {
    const result = await maintenanceService.completeTicket(req.params.id);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/tickets/:id/close', async (req: Request, res: Response) => {
  try {
    const result = await maintenanceService.closeTicket(req.params.id);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/statistics/average-repair-time', async (req: Request, res: Response) => {
  try {
    const stats = await maintenanceService.getAverageRepairTime();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
