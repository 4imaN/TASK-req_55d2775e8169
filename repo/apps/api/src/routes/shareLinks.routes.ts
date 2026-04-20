import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createShareLink,
  getSharedReservation,
  revokeShareLink,
} from '../services/reservation.service';
import { sendSuccess, sendError } from '../utils/response';

const router = Router();

// POST /api/v1/share-links
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reservationId } = req.body;
    if (!reservationId) {
      sendError(res, 422, 'VALIDATION_ERROR', 'reservationId is required');
      return;
    }
    const link = await createShareLink(req.userId!, reservationId);
    sendSuccess(res, link);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/share-links/:token
router.get('/:token', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shared = await getSharedReservation(req.params.token);
    if (!shared) {
      sendError(res, 404, 'NOT_FOUND', 'Share link not found or expired');
      return;
    }
    sendSuccess(res, shared);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/share-links/:token
router.delete('/:token', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await revokeShareLink(req.userId!, req.params.token);
    sendSuccess(res, { revoked: true });
  } catch (err) {
    next(err);
  }
});

export default router;
