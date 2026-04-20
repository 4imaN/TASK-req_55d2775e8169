import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { createRoom, updateRoom, getRoomById, listRooms } from '../services/room.service';
import { writeAuditLog } from '../services/audit.service';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';

const router = Router();

// GET /api/v1/rooms
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const zoneId = req.query.zoneId as string | undefined;
    const isActive = req.query.isActive === undefined ? undefined : req.query.isActive === 'true';
    const search = req.query.search as string | undefined;

    const { rooms, total } = await listRooms({ zoneId, isActive, search }, page, pageSize);
    sendPaginated(res, rooms, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/rooms/:id
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const room = await getRoomById(req.params.id);
    if (!room) {
      sendError(res, 404, 'NOT_FOUND', 'Room not found');
      return;
    }
    sendSuccess(res, room);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/rooms
router.post('/', authenticate, requireRole('creator', 'administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { zoneId, name, description, capacity, amenities } = req.body;
    const room = await createRoom(zoneId, name, description, capacity, amenities);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'creator',
      action: 'room.create',
      objectType: 'room',
      objectId: room._id.toString(),
      newValue: { name: room.name, zoneId: room.zoneId },
      requestId: req.requestId,
    });

    res.status(201);
    sendSuccess(res, room);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/rooms/:id
router.put('/:id', authenticate, requireRole('creator', 'administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, capacity, amenities, isActive, version } = req.body;
    if (version === undefined) {
      sendError(res, 422, 'VALIDATION_ERROR', 'Version is required for updates');
      return;
    }

    const oldRoom = await getRoomById(req.params.id);
    const room = await updateRoom(req.params.id, { name, description, capacity, amenities, isActive }, version);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'creator',
      action: 'room.update',
      objectType: 'room',
      objectId: room._id.toString(),
      oldValue: oldRoom ? { name: oldRoom.name, isActive: oldRoom.isActive } : undefined,
      newValue: { name: room.name, isActive: room.isActive },
      requestId: req.requestId,
    });

    sendSuccess(res, room);
  } catch (err) {
    next(err);
  }
});

export default router;
