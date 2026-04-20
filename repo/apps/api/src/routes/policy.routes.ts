import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { writeAuditLog } from '../services/audit.service';
import { getCollection } from '../config/db';
import { ValidationError, NotFoundError } from '../services/auth.service';

const router = Router();

// GET /api/v1/policies — admin only, lists policy versions paginated
router.get(
  '/',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
      const policyArea = req.query.policyArea as string | undefined;

      const col = getCollection('policy_versions');
      const query: Record<string, unknown> = {};
      if (policyArea) query.policyArea = policyArea;

      const total = await col.countDocuments(query);
      const data = await col
        .find(query)
        .sort({ policyArea: 1, effectiveAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray();

      sendPaginated(res, data, total, page, pageSize);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/policies/:id — admin only, get single policy version
router.get(
  '/:id',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let oid: ObjectId;
      try {
        oid = new ObjectId(req.params.id);
      } catch {
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid policy version id');
        return;
      }

      const col = getCollection('policy_versions');
      const doc = await col.findOne({ _id: oid });
      if (!doc) {
        sendError(res, 404, 'NOT_FOUND', 'Policy version not found');
        return;
      }

      sendSuccess(res, doc);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/policies — admin only, creates new policy version
router.post(
  '/',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { policyArea, settings, effectiveAt } = req.body;

      if (!policyArea || typeof policyArea !== 'string' || policyArea.trim().length === 0) {
        sendError(res, 422, 'VALIDATION_ERROR', 'policyArea is required');
        return;
      }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        sendError(res, 422, 'VALIDATION_ERROR', 'settings must be a non-array object');
        return;
      }
      if (!effectiveAt) {
        sendError(res, 422, 'VALIDATION_ERROR', 'effectiveAt is required');
        return;
      }

      const effectiveDate = new Date(effectiveAt);
      if (isNaN(effectiveDate.getTime())) {
        sendError(res, 422, 'VALIDATION_ERROR', 'effectiveAt must be a valid ISO date');
        return;
      }

      const now = new Date();
      const doc = {
        policyArea: policyArea.trim(),
        settings,
        effectiveAt: effectiveDate,
        createdByUserId: req.userId!,
        createdAt: now,
      };

      const col = getCollection('policy_versions');
      const result = await col.insertOne(doc as any);

      const created = { ...doc, _id: result.insertedId.toString() };

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: (req.userRoles || []).join(',') || 'administrator',
        action: 'policy_version.create',
        objectType: 'policy_version',
        objectId: result.insertedId.toString(),
        newValue: { policyArea: doc.policyArea, effectiveAt: effectiveDate.toISOString() },
        requestId: req.requestId || '',
      });

      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
