import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import {
  addFavorite,
  removeFavorite,
  listFavorites,
} from '../services/reservation.service';
import { sendSuccess, sendError } from '../utils/response';

const router = Router();

// GET /api/v1/favorites
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const favorites = await listFavorites(req.userId!);
    sendSuccess(res, favorites);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/favorites
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId } = req.body;
    if (!roomId) {
      sendError(res, 422, 'VALIDATION_ERROR', 'roomId is required');
      return;
    }
    await addFavorite(req.userId!, roomId);
    sendSuccess(res, { favorited: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/favorites/:roomId
router.delete('/:roomId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await removeFavorite(req.userId!, req.params.roomId);
    sendSuccess(res, { unfavorited: true });
  } catch (err) {
    next(err);
  }
});

export default router;
