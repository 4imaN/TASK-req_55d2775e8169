import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, requireRole, hasRole, optionalAuth } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { writeAuditLog } from '../services/audit.service';
import {
  createReview,
  updateReview,
  getReview,
  listReviews,
  featureReview,
  addReviewMedia,
  getReviewMedia,
  downloadReviewMedia,
} from '../services/review.service';
import { REVIEW_MAX_IMAGES } from '@studyroomops/shared-policy';

const router = Router();

// Multer for review media: memory storage, max 10MB per file, max 5 files
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/v1/reviews
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reservationId, rating, text, idempotencyKey } = req.body;

    if (!reservationId || rating === undefined || !text) {
      sendError(res, 400, 'VALIDATION_ERROR', 'reservationId, rating, and text are required');
      return;
    }

    const review = await createReview(
      req.userId!,
      reservationId,
      rating,
      text,
      idempotencyKey
    );

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: (req.userRoles || []).join(',') || 'user',
      action: 'review.create',
      objectType: 'review',
      objectId: String((review as any)._id),
      newValue: { reservationId, rating },
      requestId: req.requestId || '',
    });

    res.status(201).json({ ok: true, data: review });
  } catch (err: any) {
    if (err.name === 'SpamLimitError') {
      sendError(res, 429, 'SPAM_LIMIT', err.message, {
        nextAllowedAt: err.nextAllowedAt,
      });
      return;
    }
    next(err);
  }
});

// GET /api/v1/reviews
router.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, state, pinned, authorId, dateFrom, dateTo } = req.query;
    if (!roomId) {
      sendError(res, 400, 'VALIDATION_ERROR', 'roomId query parameter is required');
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const isStaff = req.userRoles
      ? hasRole(req.userRoles, 'moderator')
      : false;

    const { data, total } = await listReviews(
      roomId as string,
      {
        state: state as string | undefined,
        pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined,
        authorId: authorId as string | undefined,
        dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo: dateTo ? new Date(dateTo as string) : undefined,
        isStaff,
      },
      page,
      pageSize
    );

    sendPaginated(res, data, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reviews/:id
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const review = await getReview(req.params.id, req.userId, req.userRoles);
    sendSuccess(res, review);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/reviews/:id
router.put('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rating, text } = req.body;

    const updated = await updateReview(req.params.id, req.userId!, { rating, text });

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: (req.userRoles || []).join(',') || 'user',
      action: 'review.update',
      objectType: 'review',
      objectId: req.params.id,
      newValue: { rating, text: text ? '[updated]' : undefined },
      requestId: req.requestId || '',
    });

    sendSuccess(res, updated);
  } catch (err: any) {
    if (err.name === 'SpamLimitError') {
      sendError(res, 429, 'SPAM_LIMIT', err.message, {
        nextAllowedAt: err.nextAllowedAt,
      });
      return;
    }
    next(err);
  }
});

// POST /api/v1/reviews/:id/media
router.post(
  '/:id/media',
  authenticate,
  mediaUpload.array('media', REVIEW_MAX_IMAGES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'At least one file must be uploaded with field name "media"');
        return;
      }

      const mediaFiles = files.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        buffer: f.buffer,
      }));

      const media = await addReviewMedia(req.params.id, req.userId!, mediaFiles);

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: (req.userRoles || []).join(',') || 'user',
        action: 'review.media.upload',
        objectType: 'review_media',
        objectId: req.params.id,
        newValue: { count: media.length },
        requestId: req.requestId || '',
      });

      res.status(201).json({ ok: true, data: media });
    } catch (err: any) {
      if (['ValidationError', 'NotFoundError', 'ForbiddenError'].includes(err.name)) {
        const statusMap: Record<string, number> = { ValidationError: 422, NotFoundError: 404, ForbiddenError: 403 };
        sendError(res, statusMap[err.name] || 400, err.name.replace('Error', '').toUpperCase(), err.message);
        return;
      }
      next(err);
    }
  }
);

// GET /api/v1/reviews/:id/media
router.get(
  '/:id/media',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const media = await getReviewMedia(req.params.id, req.userId, req.userRoles);
      sendSuccess(res, media);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/reviews/:id/media/:mediaId/download
router.get(
  '/:id/media/:mediaId/download',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { buffer, mimeType, filename } = await downloadReviewMedia(
        req.params.id,
        req.params.mediaId,
        req.userId,
        req.userRoles
      );

      const safeFilename = encodeURIComponent(filename).replace(/'/g, '%27');
      const disposition = mimeType.startsWith('image/') ? 'inline' : 'attachment';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err: any) {
      if (['ValidationError', 'NotFoundError', 'ForbiddenError'].includes(err.name)) {
        const statusMap: Record<string, number> = { ValidationError: 422, NotFoundError: 404, ForbiddenError: 403 };
        sendError(res, statusMap[err.name] || 400, err.name.replace('Error', '').toUpperCase(), err.message);
        return;
      }
      next(err);
    }
  }
);

// POST /api/v1/reviews/:id/feature
router.post(
  '/:id/feature',
  authenticate,
  requireRole('moderator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { featured } = req.body;
      if (typeof featured !== 'boolean') {
        sendError(res, 400, 'VALIDATION_ERROR', 'featured must be a boolean');
        return;
      }

      const updated = await featureReview(
        req.params.id,
        featured,
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
