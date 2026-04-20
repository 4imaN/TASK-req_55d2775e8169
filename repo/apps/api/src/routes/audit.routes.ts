import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { verifyAuditChain } from '../services/audit.service';
import { getAppendOnlyCollection } from '../config/db';
import { sendSuccess, sendPaginated } from '../utils/response';

const router = Router();

// GET /api/v1/audit-logs (admin only)
router.get('/', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
    const objectType = req.query.objectType as string | undefined;
    const actorUserId = req.query.actorUserId as string | undefined;
    const action = req.query.action as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const query: Record<string, unknown> = {};
    if (objectType) query.objectType = objectType;
    if (actorUserId) query.actorUserId = actorUserId;
    if (action) query.action = { $regex: action, $options: 'i' };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) (query.createdAt as Record<string, unknown>).$gte = new Date(startDate);
      if (endDate) (query.createdAt as Record<string, unknown>).$lte = new Date(endDate);
    }

    const col = getAppendOnlyCollection('audit_logs');
    const total = await col.countDocuments(query);
    const logs = await col
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    sendPaginated(res, logs, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/audit-logs/verify (admin only)
router.get('/verify', authenticate, requireRole('administrator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await verifyAuditChain();
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

export default router;
