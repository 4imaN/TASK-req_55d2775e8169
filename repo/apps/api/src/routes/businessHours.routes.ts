import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  setBusinessHours,
  getBusinessHours,
  getEffectiveBusinessHours,
  deleteBusinessHours,
} from '../services/businessHours.service';
import { writeAuditLog } from '../services/audit.service';
import { sendSuccess, sendError } from '../utils/response';

const router = Router();

// GET /api/v1/business-hours?scope=site|zone|room&scopeId=...
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = (req.query.scope as string) || 'site';
    const scopeId = req.query.scopeId as string | undefined;

    if (!['site', 'zone', 'room'].includes(scope)) {
      sendError(res, 422, 'VALIDATION_ERROR', 'Invalid scope');
      return;
    }

    const hours = await getBusinessHours(scope as 'site' | 'zone' | 'room', scopeId);
    sendSuccess(res, hours);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/business-hours/effective?roomId=...&zoneId=...&dayOfWeek=...
router.get('/effective', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, zoneId, dayOfWeek } = req.query;
    if (!roomId || !zoneId || dayOfWeek === undefined) {
      sendError(res, 422, 'VALIDATION_ERROR', 'roomId, zoneId, and dayOfWeek are required');
      return;
    }

    const effective = await getEffectiveBusinessHours(
      roomId as string,
      zoneId as string,
      parseInt(dayOfWeek as string)
    );

    sendSuccess(res, effective);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/business-hours
router.post('/', authenticate, requireRole('creator', 'administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scope, scopeId, dayOfWeek, openTime, closeTime } = req.body;
    const hours = await setBusinessHours(scope, scopeId || null, dayOfWeek, openTime, closeTime);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'creator',
      action: 'business_hours.set',
      objectType: 'business_hours',
      objectId: hours._id.toString(),
      newValue: { scope, scopeId, dayOfWeek, openTime, closeTime },
      requestId: req.requestId,
    });

    sendSuccess(res, hours);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/business-hours/:id
router.delete('/:id', authenticate, requireRole('creator', 'administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteBusinessHours(req.params.id);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'creator',
      action: 'business_hours.delete',
      objectType: 'business_hours',
      objectId: req.params.id,
      requestId: req.requestId,
    });

    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
