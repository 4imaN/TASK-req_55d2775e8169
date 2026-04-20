import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import {
  getUserMembership,
  listMembershipTiers,
  listMemberAccounts,
  createTier,
  updateTier,
  assignTier,
} from '../services/membership.service';
import { ValidationError, ConflictError, NotFoundError } from '../services/auth.service';

const router = Router();

// GET /api/v1/membership/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getUserMembership(req.userId!);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/membership/members  (admin only)
router.get(
  '/members',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
      const search = req.query.search as string | undefined;

      const { members, total } = await listMemberAccounts({ search }, page, pageSize);
      sendPaginated(res, members, total, page, pageSize);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/membership/tiers
router.get('/tiers', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tiers = await listMembershipTiers();
    sendSuccess(res, tiers);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/membership/tiers  (admin only)
router.post(
  '/tiers',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, benefits } = req.body;
      if (!name) {
        sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
        return;
      }
      const tier = await createTier(name, description || '', benefits || {}, req.userId!);
      res.status(201).json({ ok: true, data: tier });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else if (err instanceof ConflictError) {
        sendError(res, 409, 'CONFLICT', err.message);
      } else {
        next(err);
      }
    }
  }
);

// PUT /api/v1/membership/tiers/:id  (admin only)
router.put(
  '/tiers/:id',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, benefits, isActive } = req.body;
      const version = parseInt(req.body.version, 10);
      if (isNaN(version)) {
        sendError(res, 400, 'VALIDATION_ERROR', 'version is required (integer)');
        return;
      }
      const updated = await updateTier(req.params.id, { name, description, benefits, isActive }, version, req.userId!);
      sendSuccess(res, updated);
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else if (err instanceof NotFoundError) {
        sendError(res, 404, 'NOT_FOUND', err.message);
      } else if (err instanceof ConflictError) {
        sendError(res, 409, 'CONFLICT', err.message);
      } else {
        next(err);
      }
    }
  }
);

// PUT /api/v1/membership/assign  (admin only)
router.put(
  '/assign',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, tierId } = req.body;
      if (!userId) {
        sendError(res, 400, 'VALIDATION_ERROR', 'userId is required');
        return;
      }
      const account = await assignTier(userId, tierId ?? null, req.userId!);
      sendSuccess(res, account);
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
