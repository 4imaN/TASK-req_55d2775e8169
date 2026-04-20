import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated, sendError } from '../utils/response';
import { createExportJob, getExportJob, listExportJobs, ExportType } from '../services/export.service';
import { ValidationError, NotFoundError } from '../services/auth.service';

const router = Router();

// All export routes are admin-only
const adminOnly = [authenticate, requireRole('administrator')];

// POST /api/v1/exports  (admin create export job)
router.post('/', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { exportType, filters } = req.body;
    if (!exportType) {
      sendError(res, 400, 'VALIDATION_ERROR', 'exportType is required');
      return;
    }
    const job = await createExportJob(req.userId!, exportType as ExportType, filters || {});
    res.status(202).json({ ok: true, data: job });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/exports  (admin list)
router.get('/', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const filters: { userId?: string; status?: string } = {};
    if (req.query.userId) filters.userId = req.query.userId as string;
    if (req.query.status) filters.status = req.query.status as string;

    const { jobs, total } = await listExportJobs(filters, page, pageSize);
    sendPaginated(res, jobs, total, page, pageSize);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/exports/:id  (admin get status)
router.get('/:id', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await getExportJob(req.params.id);
    sendSuccess(res, job);
  } catch (err: any) {
    if (err instanceof ValidationError) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else if (err instanceof NotFoundError) {
      sendError(res, 404, 'NOT_FOUND', err.message);
    } else {
      next(err);
    }
  }
});

// GET /api/v1/exports/:id/download  (admin download CSV)
router.get('/:id/download', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await getExportJob(req.params.id);

    if (job.status !== 'completed') {
      sendError(res, 400, 'NOT_READY', `Export is not ready. Current status: ${job.status}`);
      return;
    }

    if (!job.filePath || !fs.existsSync(job.filePath)) {
      sendError(res, 404, 'FILE_NOT_FOUND', 'Export file not found. It may have expired.');
      return;
    }

    const filename = `export_${job.exportType}_${job._id.toString()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (job.fileHash) {
      res.setHeader('X-File-Hash-SHA256', job.fileHash);
    }

    const stream = fs.createReadStream(job.filePath);
    stream.pipe(res);
  } catch (err: any) {
    if (err instanceof ValidationError) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
    } else if (err instanceof NotFoundError) {
      sendError(res, 404, 'NOT_FOUND', err.message);
    } else {
      next(err);
    }
  }
});

export default router;
