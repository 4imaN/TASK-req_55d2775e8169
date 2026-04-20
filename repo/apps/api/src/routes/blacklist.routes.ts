import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { manualBlacklist, clearBlacklist, listBlacklistActions } from '../services/blacklist.service';
import { ValidationError, NotFoundError } from '../services/auth.service';

const router = Router();

// GET /api/v1/blacklist  (admin only)
router.get(
  '/',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

      const filters: { userId?: string; triggeredBy?: string; active?: boolean } = {};
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.triggeredBy) filters.triggeredBy = req.query.triggeredBy as string;
      if (req.query.active !== undefined) filters.active = req.query.active === 'true';

      const { actions, total } = await listBlacklistActions(filters, page, pageSize);
      sendPaginated(res, actions, total, page, pageSize);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/blacklist  (admin only - manual blacklist)
router.post(
  '/',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, reason, expiresAt } = req.body;
      if (!userId || !reason) {
        sendError(res, 400, 'VALIDATION_ERROR', 'userId and reason are required');
        return;
      }
      const expiresAtDate = expiresAt ? new Date(expiresAt) : undefined;
      if (expiresAt && isNaN(expiresAtDate!.getTime())) {
        sendError(res, 400, 'VALIDATION_ERROR', 'expiresAt must be a valid ISO date string');
        return;
      }
      await manualBlacklist(userId, reason, req.userId!, expiresAtDate);
      sendSuccess(res, { message: 'User blacklisted successfully' });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else {
        next(err);
      }
    }
  }
);

// POST /api/v1/blacklist/:userId/clear  (admin only)
router.post(
  '/:userId/clear',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await clearBlacklist(req.params.userId, req.userId!);
      sendSuccess(res, { message: 'Blacklist cleared successfully' });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else if (err instanceof NotFoundError) {
        sendError(res, 404, 'NOT_FOUND', err.message);
      } else {
        next(err);
      }
    }
  }
);

export default router;
