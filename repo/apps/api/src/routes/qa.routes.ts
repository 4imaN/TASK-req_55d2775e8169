import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole, hasRole, optionalAuth } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { writeAuditLog } from '../services/audit.service';
import {
  createThread,
  createPost,
  getThread,
  pinThread,
  collapseThread,
  listThreads,
  listPosts,
} from '../services/qa.service';

const router = Router();

// POST /api/v1/qa-threads
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, title, body } = req.body;

    if (!roomId || !title || !body) {
      sendError(res, 400, 'VALIDATION_ERROR', 'roomId, title, and body are required');
      return;
    }

    const thread = await createThread(req.userId!, roomId, title, body);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: (req.userRoles || []).join(',') || 'user',
      action: 'qa_thread.create',
      objectType: 'qa_thread',
      objectId: String((thread as any)._id),
      newValue: { roomId, title },
      requestId: req.requestId || '',
    });

    res.status(201).json({ ok: true, data: thread });
  } catch (err: any) {
    if (err.name === 'SpamLimitError') {
      sendError(res, 429, 'SPAM_LIMIT', err.message, { nextAllowedAt: err.nextAllowedAt });
      return;
    }
    next(err);
  }
});

// GET /api/v1/qa-threads
router.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, state } = req.query;
    if (!roomId) {
      sendError(res, 400, 'VALIDATION_ERROR', 'roomId query parameter is required');
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const isStaff = req.userRoles ? hasRole(req.userRoles, 'moderator') : false;

    const { data, total } = await listThreads(
      roomId as string,
      { state: state as string | undefined, isStaff },
      page,
      pageSize
    );

    sendPaginated(res, data, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/qa-threads/:id
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thread = await getThread(req.params.id, req.userId, req.userRoles);
    sendSuccess(res, thread);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/qa-threads/:id/posts
router.post('/:id/posts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { body } = req.body;

    if (!body) {
      sendError(res, 400, 'VALIDATION_ERROR', 'body is required');
      return;
    }

    const post = await createPost(req.userId!, req.params.id, body);

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: (req.userRoles || []).join(',') || 'user',
      action: 'qa_post.create',
      objectType: 'qa_post',
      objectId: String((post as any)._id),
      newValue: { threadId: req.params.id },
      requestId: req.requestId || '',
    });

    res.status(201).json({ ok: true, data: post });
  } catch (err: any) {
    if (err.name === 'SpamLimitError') {
      sendError(res, 429, 'SPAM_LIMIT', err.message, { nextAllowedAt: err.nextAllowedAt });
      return;
    }
    next(err);
  }
});

// GET /api/v1/qa-threads/:id/posts
router.get('/:id/posts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const { data, total } = await listPosts(req.params.id, page, pageSize, req.userId, req.userRoles);
    sendPaginated(res, data, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/qa-threads/:id/pin
router.put(
  '/:id/pin',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { isPinned } = req.body;
      if (typeof isPinned !== 'boolean') {
        sendError(res, 400, 'VALIDATION_ERROR', 'isPinned must be a boolean');
        return;
      }

      const updated = await pinThread(
        req.params.id,
        isPinned,
        req.userId!,
        req.userRoles || []
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: (req.userRoles || []).includes('administrator') ? 'administrator' : 'moderator',
        action: isPinned ? 'qa_thread.pin' : 'qa_thread.unpin',
        objectType: 'qa_thread',
        objectId: req.params.id,
        newValue: { isPinned },
        requestId: req.requestId || '',
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/qa-threads/:id/collapse
router.put(
  '/:id/collapse',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await collapseThread(
        req.params.id,
        req.userId!,
        req.userRoles || []
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: (req.userRoles || []).includes('administrator') ? 'administrator' : 'moderator',
        action: 'qa_thread.collapse',
        objectType: 'qa_thread',
        objectId: req.params.id,
        newValue: { state: 'collapsed' },
        requestId: req.requestId || '',
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
