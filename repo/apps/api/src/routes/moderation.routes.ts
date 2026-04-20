import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { writeAuditLog } from '../services/audit.service';
import {
  changeContentState,
  createReport,
  updateReportStatus,
  createAppeal,
  updateAppealStatus,
  listReports,
  listAppeals,
} from '../services/moderation.service';

const router = Router();

// ── Reports ───────────────────────────────────────────────────────────────────

// POST /api/v1/moderation/reports
router.post('/reports', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contentType, contentId, reason } = req.body;

    if (!contentType || !contentId || !reason) {
      sendError(res, 400, 'VALIDATION_ERROR', 'contentType, contentId, and reason are required');
      return;
    }

    const report = await createReport(req.userId!, contentType, contentId, reason);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: (req.userRoles || []).join(',') || 'user',
      action: 'report.create',
      objectType: 'content_report',
      objectId: String((report as any)._id),
      newValue: { contentType, contentId },
      requestId: req.requestId || '',
    });

    res.status(201).json({ ok: true, data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/moderation/reports
router.get(
  '/reports',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 20));

      const { data, total } = await listReports(
        {
          status: req.query.status as string | undefined,
          contentType: req.query.contentType as string | undefined,
        },
        page,
        pageSize,
        req.userId!,
        req.userRoles || []
      );

      sendPaginated(res, data, total, page, pageSize);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/moderation/reports/:id
router.put(
  '/reports/:id',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!status) {
        sendError(res, 400, 'VALIDATION_ERROR', 'status is required');
        return;
      }

      const updated = await updateReportStatus(
        req.params.id,
        status,
        req.userId!,
        req.userRoles || []
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: (req.userRoles || []).includes('administrator') ? 'administrator' : 'moderator',
        action: 'report.status_update',
        objectType: 'content_report',
        objectId: req.params.id,
        newValue: { status },
        requestId: req.requestId || '',
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── Appeals ───────────────────────────────────────────────────────────────────

// POST /api/v1/moderation/appeals
router.post('/appeals', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contentType, contentId, moderationActionId, reason } = req.body;

    if (!contentType || !contentId || !moderationActionId || !reason) {
      sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'contentType, contentId, moderationActionId, and reason are required'
      );
      return;
    }

    const appeal = await createAppeal(
      req.userId!,
      contentType,
      contentId,
      moderationActionId,
      reason
    );

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: (req.userRoles || []).join(',') || 'user',
      action: 'appeal.create',
      objectType: 'content_appeal',
      objectId: String((appeal as any)._id),
      newValue: { contentType, contentId, moderationActionId },
      requestId: req.requestId || '',
    });

    res.status(201).json({ ok: true, data: appeal });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/moderation/appeals
router.get(
  '/appeals',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 20));

      const { data, total } = await listAppeals(
        {
          status: req.query.status as string | undefined,
          contentType: req.query.contentType as string | undefined,
        },
        page,
        pageSize,
        req.userId!,
        req.userRoles || []
      );

      sendPaginated(res, data, total, page, pageSize);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/moderation/appeals/:id
router.put(
  '/appeals/:id',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!status) {
        sendError(res, 400, 'VALIDATION_ERROR', 'status is required');
        return;
      }

      const updated = await updateAppealStatus(
        req.params.id,
        status,
        req.userId!,
        req.userRoles || []
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: (req.userRoles || []).includes('administrator') ? 'administrator' : 'moderator',
        action: 'appeal.status_update',
        objectType: 'content_appeal',
        objectId: req.params.id,
        newValue: { status },
        requestId: req.requestId || '',
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── Content State Change (direct moderator action) ─────────────────────────

// PUT /api/v1/moderation/content-state
router.put(
  '/content-state',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contentType, contentId, state } = req.body;

      if (!contentType || !contentId || !state) {
        sendError(res, 400, 'VALIDATION_ERROR', 'contentType, contentId, and state are required');
        return;
      }

      const updated = await changeContentState(
        contentType,
        contentId,
        state,
        req.userId!,
        req.userRoles || []
      );

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
