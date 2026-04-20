import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { createDispute, updateDisputeStatus, listDisputes, getDispute } from '../services/dispute.service';
import { ValidationError, ConflictError, NotFoundError } from '../services/auth.service';

const router = Router();

// POST /api/v1/wallet/disputes  (user self-service)
router.post(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ledgerEntryId, reason, idempotencyKey } = req.body;
      if (!ledgerEntryId || !reason || !idempotencyKey) {
        sendError(res, 400, 'VALIDATION_ERROR', 'ledgerEntryId, reason, and idempotencyKey are required');
        return;
      }
      const dispute = await createDispute(req.userId!, ledgerEntryId, reason, idempotencyKey);
      res.status(201).json({ ok: true, data: dispute });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        sendError(res, 400, 'VALIDATION_ERROR', err.message);
      } else if (err instanceof ConflictError) {
        sendError(res, 409, 'CONFLICT', err.message);
      } else if (err instanceof NotFoundError) {
        sendError(res, 404, 'NOT_FOUND', err.message);
      } else {
        next(err);
      }
    }
  }
);

// GET /api/v1/wallet/disputes  (admin only)
router.get(
  '/',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

      const filters: { userId?: string; status?: string; startDate?: Date; endDate?: Date } = {};
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      const { disputes, total } = await listDisputes(filters, page, pageSize);
      sendPaginated(res, disputes, total, page, pageSize);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/wallet/disputes/:id  (admin only)
router.put(
  '/:id',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, internalNotes } = req.body;
      if (!status) {
        sendError(res, 400, 'VALIDATION_ERROR', 'status is required');
        return;
      }
      const updated = await updateDisputeStatus(req.params.id, status, req.userId!, internalNotes);
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

export default router;
