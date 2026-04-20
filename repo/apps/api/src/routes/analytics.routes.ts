import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import {
  computeBookingConversion,
  computeAttendanceRate,
  computeNoshowRate,
  computePeakUtilization,
  computeOffPeakUtilization,
  computePolicyImpact,
  getSnapshots,
  KpiName,
  Grain,
} from '../services/analytics.service';
import { ValidationError, NotFoundError } from '../services/auth.service';

const router = Router();

// All analytics routes are admin-only
const adminOnly = [authenticate, requireRole('administrator')];

function parseFilters(req: any): {
  grain: Grain;
  roomId?: string;
  zoneId?: string;
  startDate: Date;
  endDate: Date;
} {
  const grain = (req.query.grain as Grain) || 'day';
  const validGrains: Grain[] = ['day', 'week', 'month'];
  if (!validGrains.includes(grain)) {
    throw new Error(`Invalid grain. Must be one of: ${validGrains.join(', ')}`);
  }

  const startDate = req.query.startDate
    ? new Date(req.query.startDate as string)
    : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const endDate = req.query.endDate
    ? new Date(req.query.endDate as string)
    : new Date();

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid startDate or endDate');
  }

  return {
    grain,
    roomId: req.query.roomId as string | undefined,
    zoneId: req.query.zoneId as string | undefined,
    startDate,
    endDate,
  };
}

// GET /api/v1/analytics/booking-conversion
router.get('/booking-conversion', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req);
    const value = await computeBookingConversion(filters);
    sendSuccess(res, { kpi: 'booking_conversion', ...filters, value });
  } catch (err: any) {
    if (err instanceof ValidationError || err.message.includes('Invalid')) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/analytics/attendance-rate
router.get('/attendance-rate', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req);
    const value = await computeAttendanceRate(filters);
    sendSuccess(res, { kpi: 'attendance_rate', ...filters, value });
  } catch (err: any) {
    if (err instanceof ValidationError || err.message.includes('Invalid')) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/analytics/noshow-rate
router.get('/noshow-rate', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req);
    const value = await computeNoshowRate(filters);
    sendSuccess(res, { kpi: 'noshow_rate', ...filters, value });
  } catch (err: any) {
    if (err instanceof ValidationError || err.message.includes('Invalid')) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/analytics/peak-utilization
router.get('/peak-utilization', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req);
    const value = await computePeakUtilization(filters);
    sendSuccess(res, { kpi: 'peak_utilization', ...filters, value });
  } catch (err: any) {
    if (err instanceof ValidationError || err.message.includes('Invalid')) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/analytics/offpeak-utilization
router.get('/offpeak-utilization', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = parseFilters(req);
    const value = await computeOffPeakUtilization(filters);
    sendSuccess(res, { kpi: 'offpeak_utilization', ...filters, value });
  } catch (err: any) {
    if (err instanceof ValidationError || err.message.includes('Invalid')) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/analytics/policy-impact
router.get('/policy-impact', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { policyVersionId, kpiName, windowDays } = req.query;
    if (!policyVersionId || !kpiName) {
      sendError(res, 400, 'VALIDATION_ERROR', 'policyVersionId and kpiName are required');
      return;
    }
    const days = parseInt(windowDays as string) || 30;
    const result = await computePolicyImpact(
      policyVersionId as string,
      kpiName as KpiName,
      days
    );
    sendSuccess(res, { policyVersionId, kpiName, windowDays: days, ...result });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else if (err instanceof NotFoundError) {
      sendError(res, 404, 'NOT_FOUND', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/analytics/snapshots
router.get('/snapshots', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const filters: Record<string, unknown> = {};
    if (req.query.kpiName) filters.kpiName = req.query.kpiName;
    if (req.query.grain) filters.grain = req.query.grain;
    if (req.query.roomId) filters.roomId = req.query.roomId;
    if (req.query.zoneId) filters.zoneId = req.query.zoneId;
    if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

    const { snapshots, total } = await getSnapshots(filters as any, page, pageSize);
    sendPaginated(res, snapshots, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

export default router;
