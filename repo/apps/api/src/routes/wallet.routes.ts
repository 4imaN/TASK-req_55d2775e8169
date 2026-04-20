import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import {
  topUp,
  spend,
  refund,
  redeemPoints,
  getBalance,
  getLedgerEntries,
  getDailyRiskUsage,
} from '../services/wallet.service';
import { ValidationError, NotFoundError } from '../services/auth.service';

const router = Router();

// POST /api/v1/wallet/topup  (admin only)
router.post(
  '/topup',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, amountCents, description, idempotencyKey } = req.body;
      if (!userId || !amountCents || !idempotencyKey) {
        sendError(res, 400, 'VALIDATION_ERROR', 'userId, amountCents, and idempotencyKey are required');
        return;
      }
      const result = await topUp(userId, amountCents, description || 'Top-up', req.userId!, idempotencyKey, req.requestId);
      sendSuccess(res, result);
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else {
        next(err);
      }
    }
  }
);

// POST /api/v1/wallet/spend  (admin only)
router.post(
  '/spend',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, amountCents, description, referenceType, referenceId, idempotencyKey } = req.body;
      if (!userId || !amountCents || !idempotencyKey) {
        sendError(res, 400, 'VALIDATION_ERROR', 'userId, amountCents, and idempotencyKey are required');
        return;
      }
      const result = await spend(
        userId,
        amountCents,
        description || 'Charge',
        referenceType,
        referenceId,
        req.userId!,
        idempotencyKey,
        req.requestId
      );
      sendSuccess(res, result);
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else {
        next(err);
      }
    }
  }
);

// POST /api/v1/wallet/refund  (admin only)
router.post(
  '/refund',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, amountCents, originalEntryId, description, idempotencyKey } = req.body;
      if (!userId || !amountCents || !originalEntryId || !idempotencyKey) {
        sendError(res, 400, 'VALIDATION_ERROR', 'userId, amountCents, originalEntryId, and idempotencyKey are required');
        return;
      }
      const result = await refund(userId, amountCents, originalEntryId, description || 'Refund', req.userId!, idempotencyKey, req.requestId);
      sendSuccess(res, result);
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

// POST /api/v1/wallet/redeem-points  (self-service)
router.post(
  '/redeem-points',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pointsToRedeem, idempotencyKey } = req.body;
      if (!pointsToRedeem || !idempotencyKey) {
        sendError(res, 400, 'VALIDATION_ERROR', 'pointsToRedeem and idempotencyKey are required');
        return;
      }
      const result = await redeemPoints(req.userId!, pointsToRedeem, req.userId!, idempotencyKey, req.requestId);
      sendSuccess(res, result);
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else {
        next(err);
      }
    }
  }
);

// GET /api/v1/wallet/balance
router.get('/balance', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Admin can query any user; member can only query own
    const targetUserId = req.userRoles?.includes('administrator') && req.query.userId
      ? (req.query.userId as string)
      : req.userId!;

    const [balanceCents, dailyUsage] = await Promise.all([
      getBalance(targetUserId),
      getDailyRiskUsage(targetUserId),
    ]);

    sendSuccess(res, { userId: targetUserId, balanceCents, dailyUsageCents: dailyUsage });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/wallet/ledger
router.get('/ledger', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    // Admins can query any userId; members can only see own
    const isAdmin = req.userRoles?.includes('administrator');
    const targetUserId = isAdmin && req.query.userId
      ? (req.query.userId as string)
      : req.userId!;

    const filters: { type?: string; startDate?: Date; endDate?: Date } = {};
    if (req.query.type) filters.type = req.query.type as string;
    if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

    const { entries, total } = await getLedgerEntries(targetUserId, filters, page, pageSize);
    sendPaginated(res, entries, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

export default router;
