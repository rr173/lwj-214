import { Router, Request, Response } from 'express';
import * as personService from '../services/maintenancePersonService';

const router = Router();

router.post('/persons', async (req: Request, res: Response) => {
  try {
    const result = await personService.registerMaintenancePerson(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/persons', async (req: Request, res: Response) => {
  try {
    const persons = await personService.getAllMaintenancePersons();
    res.json({ success: true, data: persons });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/persons/:id', async (req: Request, res: Response) => {
  try {
    const person = await personService.getMaintenancePersonById(req.params.id);
    if (!person) {
      return res.status(404).json({ success: false, error: '维修人员不存在' });
    }
    res.json({ success: true, data: person });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/persons/employee/:employeeId', async (req: Request, res: Response) => {
  try {
    const person = await personService.getMaintenancePersonByEmployeeId(req.params.employeeId);
    if (!person) {
      return res.status(404).json({ success: false, error: '维修人员不存在' });
    }
    res.json({ success: true, data: person });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/persons/schedule', async (req: Request, res: Response) => {
  try {
    const result = await personService.setPersonSchedule(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/persons/:id/schedule/:date', async (req: Request, res: Response) => {
  try {
    const result = await personService.getPersonSchedule(req.params.id, req.params.date);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/persons/:id/availability/:date', async (req: Request, res: Response) => {
  try {
    const result = await personService.getPersonTicketsAndAvailability(req.params.id, req.params.date);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/statistics/monthly', async (req: Request, res: Response) => {
  try {
    const month = req.query.month as string;
    const personId = req.query.personId as string | undefined;
    const result = await personService.getMonthlyPersonStatistics(month, personId);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
