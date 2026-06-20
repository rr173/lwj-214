import { Router, Request, Response } from 'express';
import * as bookingService from '../services/bookingService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await bookingService.createBooking(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, error: '预约不存在' });
    }
    res.json({ success: true, data: booking });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/room/:roomNumber/:date', async (req: Request, res: Response) => {
  try {
    const { roomNumber, date } = req.params;
    const bookings = await bookingService.getBookingsByRoomAndDate(roomNumber, date);
    res.json({ success: true, data: bookings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/range/:startDate/:endDate', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.params;
    const includeCancelled = req.query.includeCancelled !== 'false';
    const bookings = await bookingService.getBookingsByDateRange(startDate, endDate, includeCancelled);
    res.json({ success: true, data: bookings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const result = await bookingService.updateBooking(req.params.id, req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { cancelReason } = req.body;
    const result = await bookingService.cancelBooking(req.params.id, cancelReason);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.errors });
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
