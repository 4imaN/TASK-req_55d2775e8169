import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, hasRole } from '../middleware/auth';
import {
  createReservation,
  cancelReservation,
  checkIn,
  getReservation,
  listUserReservations,
  listAllReservations,
  getAvailability,
} from '../services/reservation.service';
import { writeAuditLog } from '../services/audit.service';
import { getCollection } from '../config/db';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';

const router = Router();

// GET /api/v1/availability?roomId=...&startDate=...&endDate=...
router.get('/availability', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, startDate, endDate } = req.query;
    if (!roomId || !startDate || !endDate) {
      sendError(res, 422, 'VALIDATION_ERROR', 'roomId, startDate, and endDate are required');
      return;
    }

    const availability = await getAvailability(roomId as string, startDate as string, endDate as string);
    sendSuccess(res, availability);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/reservations
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, startAtUtc, endAtUtc, idempotencyKey, notes } = req.body;

    if (!roomId || !startAtUtc || !endAtUtc || !idempotencyKey) {
      sendError(res, 422, 'VALIDATION_ERROR', 'roomId, startAtUtc, endAtUtc, and idempotencyKey are required');
      return;
    }

    const result = await createReservation(req.userId!, roomId, startAtUtc, endAtUtc, idempotencyKey, notes);

    // Record the attempt for booking conversion analytics
    await getCollection('reservation_attempts').insertOne({
      userId: req.userId,
      roomId: req.body.roomId,
      attemptedAt: new Date(),
      successful: !('conflict' in result),
    } as any);

    if ('conflict' in result) {
      sendError(res, 409, 'RESERVATION_CONFLICT', 'Requested room is unavailable for one or more slices.', {
        conflictReason: result.reason,
        requestedStart: startAtUtc,
        requestedEnd: endAtUtc,
        alternatives: result.alternatives,
      });
      return;
    }

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'user',
      action: 'reservation.create',
      objectType: 'reservation',
      objectId: result.reservation._id.toString(),
      newValue: {
        roomId,
        startAtUtc,
        endAtUtc,
        status: 'confirmed',
      },
      requestId: req.requestId,
    });

    res.status(201);
    sendSuccess(res, result.reservation);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reservations
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const status = req.query.status as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    // Staff can see all, users see own
    const isStaffUser = hasRole(req.userRoles || [], 'creator');
    if (isStaffUser && req.query.userId) {
      const { reservations, total } = await listAllReservations(
        { userId: req.query.userId as string, status, startDate, endDate },
        page,
        pageSize
      );
      sendPaginated(res, reservations, total, page, pageSize);
    } else if (isStaffUser && !req.query.mine) {
      const { reservations, total } = await listAllReservations(
        {
          roomId: req.query.roomId as string,
          zoneId: req.query.zoneId as string,
          status,
          startDate,
          endDate,
        },
        page,
        pageSize
      );
      sendPaginated(res, reservations, total, page, pageSize);
    } else {
      const { reservations, total } = await listUserReservations(
        req.userId!,
        { status, startDate, endDate },
        page,
        pageSize
      );
      sendPaginated(res, reservations, total, page, pageSize);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reservations/:id  (defined after all static-segment routes)
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reservation = await getReservation(req.params.id);
    if (!reservation) {
      sendError(res, 404, 'NOT_FOUND', 'Reservation not found');
      return;
    }

    // Check access
    const isOwner = reservation.userId === req.userId;
    const isStaffUser = hasRole(req.userRoles || [], 'creator');
    if (!isOwner && !isStaffUser) {
      sendError(res, 403, 'FORBIDDEN', 'Not authorized to view this reservation');
      return;
    }

    sendSuccess(res, reservation);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/reservations/:id/cancel
router.post('/:id/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    const reservation = await cancelReservation(
      req.params.id,
      req.userId!,
      req.userRoles || [],
      reason
    );

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'user',
      action: 'reservation.cancel',
      objectType: 'reservation',
      objectId: req.params.id,
      newValue: { status: 'canceled', reason },
      requestId: req.requestId,
    });

    sendSuccess(res, reservation);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/reservations/:id/check-in
router.post('/:id/check-in', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reservation = await getReservation(req.params.id);
    if (!reservation) {
      sendError(res, 404, 'NOT_FOUND', 'Reservation not found');
      return;
    }

    // Regular users can self-check-in, staff can check in anyone
    const isOwner = reservation.userId === req.userId;
    const isStaffUser = hasRole(req.userRoles || [], 'creator');

    if (!isOwner && !isStaffUser) {
      sendError(res, 403, 'FORBIDDEN', 'Not authorized to check in this reservation');
      return;
    }

    const source = isStaffUser && !isOwner ? 'staff' : 'manual';
    const updated = await checkIn(req.params.id, req.userId!, source);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'user',
      action: 'reservation.check_in',
      objectType: 'reservation',
      objectId: req.params.id,
      newValue: { status: 'checked_in', source },
      requestId: req.requestId,
    });

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
});

export default router;
