import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { createZone, updateZone, getZoneById, listZones } from '../services/zone.service';
import { writeAuditLog } from '../services/audit.service';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';

const router = Router();

// GET /api/v1/zones
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const isActive = req.query.isActive === undefined ? undefined : req.query.isActive === 'true';

    const { zones, total } = await listZones({ isActive }, page, pageSize);
    sendPaginated(res, zones, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/zones/:id
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const zone = await getZoneById(req.params.id);
    if (!zone) {
      sendError(res, 404, 'NOT_FOUND', 'Zone not found');
      return;
    }
    sendSuccess(res, zone);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/zones
router.post('/', authenticate, requireRole('creator', 'administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description } = req.body;
    const zone = await createZone(name, description);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'creator',
      action: 'zone.create',
      objectType: 'zone',
      objectId: zone._id.toString(),
      newValue: { name: zone.name },
      requestId: req.requestId,
    });

    res.status(201);
    sendSuccess(res, zone);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/zones/:id
router.put('/:id', authenticate, requireRole('creator', 'administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, isActive, version } = req.body;
    if (version === undefined) {
      sendError(res, 422, 'VALIDATION_ERROR', 'Version is required for updates');
      return;
    }

    const oldZone = await getZoneById(req.params.id);
    const zone = await updateZone(req.params.id, { name, description, isActive }, version);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'creator',
      action: 'zone.update',
      objectType: 'zone',
      objectId: zone._id.toString(),
      oldValue: oldZone ? { name: oldZone.name, isActive: oldZone.isActive } : undefined,
      newValue: { name: zone.name, isActive: zone.isActive },
      requestId: req.requestId,
    });

    sendSuccess(res, zone);
  } catch (err) {
    next(err);
  }
});

export default router;
