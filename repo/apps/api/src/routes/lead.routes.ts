import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createLead,
  updateLeadStatus,
  addLeadNote,
  getLeadById,
  listLeads,
  getLeadHistory,
} from '../services/lead.service';
import {
  uploadAttachment,
  listAttachments,
  getAttachmentById,
} from '../services/attachment.service';
import { writeAuditLog } from '../services/audit.service';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';

const router = Router();

// Multer: store files in memory for validation before encrypting to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB hard cap at transport layer
});

// ── Helper: map error class names to HTTP status codes ─────────────────────

function mapServiceError(err: any): { status: number; code: string } {
  switch (err.name) {
    case 'ValidationError':
      return { status: 422, code: 'VALIDATION_ERROR' };
    case 'NotFoundError':
      return { status: 404, code: 'NOT_FOUND' };
    case 'ForbiddenError':
      return { status: 403, code: 'FORBIDDEN' };
    case 'ConflictError':
      return { status: 409, code: 'CONFLICT' };
    default:
      return { status: 500, code: 'INTERNAL_ERROR' };
  }
}

function handleServiceError(err: any, res: Response, next: NextFunction): void {
  if (['ValidationError', 'NotFoundError', 'ForbiddenError', 'ConflictError'].includes(err.name)) {
    const { status, code } = mapServiceError(err);
    sendError(res, status, code, err.message);
    return;
  }
  next(err);
}

// ── POST /api/v1/leads ─────────────────────────────────────────────────────

router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      sendError(res, 422, 'VALIDATION_ERROR', 'idempotency-key header is required');
      return;
    }

    const lead = await createLead(req.userId!, req.body, idempotencyKey.trim());

    await writeAuditLog({
      actorUserId: req.userId!,
      actorRole: req.userRoles?.[0] || 'user',
      action: 'lead.create',
      objectType: 'lead',
      objectId: (lead as any)._id,
      newValue: {
        type: req.body.type,
        status: 'New',
        budgetCapCents: req.body.budgetCapCents,
      },
      requestId: req.requestId,
    });

    res.status(201);
    sendSuccess(res, lead);
  } catch (err: any) {
    handleServiceError(err, res, next);
  }
});

// ── GET /api/v1/leads ──────────────────────────────────────────────────────

router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const filters = {
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
    };

    const { leads, total } = await listLeads(
      req.userId!,
      req.userRoles || [],
      filters,
      page,
      pageSize
    );

    sendPaginated(res, leads, total, page, pageSize);
  } catch (err: any) {
    handleServiceError(err, res, next);
  }
});

// ── GET /api/v1/leads/:id ──────────────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lead = await getLeadById(req.params.id, req.userId!, req.userRoles || []);
    sendSuccess(res, lead);
  } catch (err: any) {
    handleServiceError(err, res, next);
  }
});

// ── PUT /api/v1/leads/:id/status ───────────────────────────────────────────

router.put(
  '/:id/status',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, quoteAmountCents, closeReason } = req.body;

      const oldLead = await getLeadById(req.params.id, req.userId!, req.userRoles || []).catch(() => null);

      const lead = await updateLeadStatus(
        req.params.id,
        status,
        req.userId!,
        req.userRoles || [],
        quoteAmountCents,
        closeReason
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: req.userRoles?.[0] || 'creator',
        action: 'lead.status_update',
        objectType: 'lead',
        objectId: req.params.id,
        oldValue: oldLead ? { status: (oldLead as any).status } : undefined,
        newValue: {
          status,
          quoteAmountCents,
          closeReason,
        },
        requestId: req.requestId,
      });

      sendSuccess(res, lead);
    } catch (err: any) {
      handleServiceError(err, res, next);
    }
  }
);

// ── POST /api/v1/leads/:id/notes ───────────────────────────────────────────

router.post(
  '/:id/notes',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content } = req.body;
      const lead = await addLeadNote(req.params.id, req.userId!, req.userRoles || [], content);

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: req.userRoles?.[0] || 'creator',
        action: 'lead.note_added',
        objectType: 'lead',
        objectId: req.params.id,
        newValue: { contentLength: content?.length },
        requestId: req.requestId,
      });

      sendSuccess(res, lead);
    } catch (err: any) {
      handleServiceError(err, res, next);
    }
  }
);

// ── GET /api/v1/leads/:id/notes ───────────────────────────────────────────

router.get(
  '/:id/notes',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lead = await getLeadById(req.params.id, req.userId!, req.userRoles || []);
      const notes = ((lead as any).notes || []).map((n: any) => ({
        _id: n.noteId,
        leadId: req.params.id,
        authorUserId: n.authorUserId,
        content: n.content,
        createdAt: n.createdAt,
      }));
      sendSuccess(res, notes);
    } catch (err: any) {
      handleServiceError(err, res, next);
    }
  }
);

// ── GET /api/v1/leads/:id/history ─────────────────────────────────────────

router.get('/:id/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only allow access if the user can view the lead
    await getLeadById(req.params.id, req.userId!, req.userRoles || []);
    const history = await getLeadHistory(req.params.id);
    sendSuccess(res, history);
  } catch (err: any) {
    handleServiceError(err, res, next);
  }
});

// ── POST /api/v1/leads/:id/attachments ────────────────────────────────────

router.post(
  '/:id/attachments',
  authenticate,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        sendError(res, 422, 'VALIDATION_ERROR', 'A file must be uploaded with the field name "file"');
        return;
      }

      const attachment = await uploadAttachment(
        'lead',
        req.params.id,
        req.userId!,
        req.userRoles || [],
        {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
        }
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: req.userRoles?.[0] || 'user',
        action: 'lead.attachment_upload',
        objectType: 'attachment',
        objectId: (attachment as any)._id,
        newValue: {
          leadId: req.params.id,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
        },
        requestId: req.requestId,
      });

      res.status(201);
      sendSuccess(res, attachment);
    } catch (err: any) {
      handleServiceError(err, res, next);
    }
  }
);

// ── GET /api/v1/leads/:id/attachments ─────────────────────────────────────

router.get('/:id/attachments', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachments = await listAttachments('lead', req.params.id, req.userId!, req.userRoles || []);
    sendSuccess(res, attachments);
  } catch (err: any) {
    handleServiceError(err, res, next);
  }
});

// ── GET /api/v1/leads/:id/attachments/:attachmentId/download ──────────────

router.get('/:id/attachments/:attachmentId/download', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { meta, buffer } = await getAttachmentById(
      req.params.attachmentId,
      req.userId!,
      req.userRoles || []
    );

    const filename = (meta.originalName as string) || 'attachment';
    const mimeType = (meta.mimeType as string) || 'application/octet-stream';
    const safeFilename = encodeURIComponent(filename).replace(/'/g, '%27');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    handleServiceError(err, res, next);
  }
});

export default router;
