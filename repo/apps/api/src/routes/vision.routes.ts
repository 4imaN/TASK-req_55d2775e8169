/**
 * StudyRoomOps Vision API Routes
 *
 * These routes coordinate with the local Python vision worker via HTTP proxy.
 * They enforce authentication, role checks, audit logging, and consent
 * validation before forwarding requests.
 *
 * Privacy invariants enforced here:
 *   - Raw image bytes are forwarded to the vision worker but never stored
 *     by the API layer.
 *   - Encrypted embeddings are handled exclusively inside the vision worker
 *     and are never surfaced in API responses.
 *   - All admin-level operations are audit-logged.
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth';
import { sendSuccess, sendError } from '../utils/response';
import { writeAuditLog } from '../services/audit.service';
import { config } from '../config';
import { getCollection } from '../config/db';

const visionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

const router = Router();

// ---------------------------------------------------------------------------
// Vision worker proxy helper
// ---------------------------------------------------------------------------

async function proxyToVisionWorker(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  if (!config.vision.enabled) {
    throw new VisionWorkerError(503, 'VISION_DISABLED', 'Vision worker is not enabled on this installation.');
  }

  const url = new URL(`${config.vision.workerUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, v);
      }
    }
  }

  const internalApiKey = process.env.VISION_INTERNAL_KEY;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(internalApiKey ? { 'X-Internal-Api-Key': internalApiKey } : {}),
    },
  };
  if (body !== undefined && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(url.toString(), options);
  } catch (err: any) {
    throw new VisionWorkerError(502, 'VISION_WORKER_UNREACHABLE', `Cannot reach vision worker: ${err.message}`);
  }

  const json = await response.json();
  return { status: response.status, data: json };
}

class VisionWorkerError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VisionWorkerError';
  }
}

function handleVisionError(res: Response, err: unknown): void {
  if (err instanceof VisionWorkerError) {
    sendError(res, err.httpStatus, err.code, err.message);
  } else {
    sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

// ---------------------------------------------------------------------------
// Detect / Recognize proxy routes (creator/admin)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/vision/detect
 * Proxy an image to the vision worker's /detect endpoint.
 * Creator and admin only. Raw image is forwarded but never stored here.
 * Accepts multipart/form-data with a 'frame' file field.
 */
router.post(
  '/detect',
  authenticate,
  requireRole('creator', 'administrator'),
  visionUpload.single('frame'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.vision.enabled) {
        sendError(res, 503, 'VISION_DISABLED', 'Vision worker is not enabled on this installation.');
        return;
      }
      if (!req.file) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Multipart field "frame" is required');
        return;
      }
      const workerUrl = config.vision.workerUrl;
      const formData = new FormData();
      formData.append('frame', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
      if (req.body.track_id) formData.append('track_id', req.body.track_id);

      const internalKey = process.env.VISION_INTERNAL_KEY || '';
      const response = await fetch(`${workerUrl}/api/v1/vision/detect`, {
        method: 'POST',
        body: formData,
        headers: internalKey ? { 'X-Internal-Api-Key': internalKey } : {},
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/vision/recognize
 * Proxy an image to the vision worker's /recognize endpoint.
 * Creator and admin only. Returns decision only — embeddings are never surfaced.
 */
router.post(
  '/recognize',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, data } = await proxyToVisionWorker('POST', '/api/v1/vision/recognize', req.body);
      // Strip any embedding fields before forwarding the response
      const safeData = data as any;
      if (safeData && typeof safeData === 'object') {
        delete safeData.embedding;
        delete safeData.embeddings;
      }
      res.status(status).json(safeData);
    } catch (err) {
      handleVisionError(res, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Camera routes (creator/admin)
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/vision/cameras
 * List all registered camera devices. Creator and admin only.
 */
router.get(
  '/cameras',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, data } = await proxyToVisionWorker('GET', '/api/v1/vision/cameras');
      res.status(status).json(data);
    } catch (err) {
      handleVisionError(res, err);
    }
  },
);

/**
 * POST /api/v1/vision/cameras
 * Register a camera device. Creator and admin only.
 */
router.post(
  '/cameras',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { device_identifier, name, location, zone_id, room_id, is_active } = req.body;
      if (!device_identifier || !name) {
        sendError(res, 400, 'VALIDATION_ERROR', '"device_identifier" and "name" are required.');
        return;
      }

      const { status, data } = await proxyToVisionWorker('POST', '/api/v1/vision/cameras', {
        device_identifier,
        name,
        location,
        zone_id,
        room_id,
        is_active,
      });

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: req.userRoles?.[0] || 'creator',
        action: 'camera.register',
        objectType: 'camera_device',
        objectId: device_identifier,
        newValue: { name, location, zone_id, room_id },
        requestId: req.requestId,
      });

      res.status(status).json(data);
    } catch (err) {
      handleVisionError(res, err);
    }
  },
);

/**
 * PUT /api/v1/vision/cameras/:id
 * Update a camera device. Creator and admin only.
 */
router.put(
  '/cameras/:id',
  authenticate,
  requireRole('creator', 'administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { name, location, zone_id, room_id, is_active } = req.body;

      const { status, data } = await proxyToVisionWorker(
        'PUT',
        `/api/v1/vision/cameras/${id}`,
        { name, location, zone_id, room_id, is_active },
      );

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: req.userRoles?.[0] || 'creator',
        action: 'camera.update',
        objectType: 'camera_device',
        objectId: id,
        newValue: { name, location, zone_id, room_id, is_active },
        requestId: req.requestId,
      });

      res.status(status).json(data);
    } catch (err) {
      handleVisionError(res, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Face events (admin only)
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/vision/events
 * List face recognition events with filters and pagination.
 * Admin only.
 */
router.get(
  '/events',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const queryParams: Record<string, string> = {};
      const allowed = ['page', 'pageSize', 'camera_id', 'decision', 'date_from', 'date_to'];
      for (const key of allowed) {
        const val = req.query[key];
        if (val !== undefined && val !== '') {
          queryParams[key] = String(val);
        }
      }

      const { status, data } = await proxyToVisionWorker(
        'GET',
        '/api/v1/vision/events',
        undefined,
        queryParams,
      );
      res.status(status).json(data);
    } catch (err) {
      handleVisionError(res, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Enrollment routes (admin only – requires consent)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/vision/enroll
 * Enroll a user's face. Admin only. Requires consent_metadata.
 *
 * Body:
 *   user_id          (string)
 *   image_samples    (string[]) – base64 images, min 3
 *   consent_metadata (object)   – { consent_given, consent_timestamp, consent_actor }
 *   overwrite        (boolean, optional)
 */
router.post(
  '/enroll',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id, image_samples, consent_metadata, overwrite } = req.body;

      if (!user_id) {
        sendError(res, 400, 'VALIDATION_ERROR', '"user_id" is required.');
        return;
      }
      if (!Array.isArray(image_samples) || image_samples.length < 3) {
        sendError(res, 400, 'VALIDATION_ERROR', 'At least 3 image_samples are required.');
        return;
      }
      if (!consent_metadata?.consent_given) {
        sendError(res, 400, 'CONSENT_REQUIRED', 'Explicit consent_metadata.consent_given = true is required.');
        return;
      }

      const { status, data } = await proxyToVisionWorker('POST', '/api/v1/vision/enroll', {
        user_id,
        image_samples,
        consent_metadata,
        overwrite: overwrite ?? false,
      });

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: 'administrator',
        action: 'vision.enroll',
        objectType: 'face_enrollment',
        objectId: user_id,
        newValue: {
          user_id,
          sample_count: image_samples.length,
          consent_given: consent_metadata.consent_given,
          consent_actor: consent_metadata.consent_actor,
        },
        requestId: req.requestId,
      });

      res.status(status).json(data);
    } catch (err) {
      handleVisionError(res, err);
    }
  },
);

/**
 * GET /api/v1/vision/enrollments/:userId
 * List face enrollments for a user. Admin only.
 * Returns metadata only – no embeddings ever exposed.
 */
router.get(
  '/enrollments/:userId',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;

      const col = getCollection('face_enrollments');
      const enrollments = await col
        .find(
          { userId },
          {
            projection: {
              // Never expose encrypted embedding in API response
              encryptedEmbedding: 0,
            },
          },
        )
        .sort({ enrolledAt: -1 })
        .toArray();

      const safeEnrollments = enrollments.map((doc: any) => ({
        enrollment_id: String(doc._id),
        user_id: doc.userId,
        sample_count: doc.sampleCount,
        embedding_dim: doc.embeddingDim,
        status: doc.status,
        enrolled_at: doc.enrolledAt?.toISOString() ?? null,
        updated_at: doc.updatedAt?.toISOString() ?? null,
        consent_given: doc.consentMetadata?.consentGiven ?? false,
        consent_actor: doc.consentMetadata?.consentActor ?? '',
        consent_timestamp: doc.consentMetadata?.consentTimestamp ?? null,
      }));

      sendSuccess(res, { enrollments: safeEnrollments, total: safeEnrollments.length });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/v1/vision/enrollments/:userId
 * Delete all face enrollments for a user. Admin only.
 * Hard-deletes from the vision worker's MongoDB collection.
 */
router.delete(
  '/enrollments/:userId',
  authenticate,
  requireRole('administrator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;

      const col = getCollection('face_enrollments');
      const result = await col.deleteMany({ userId });

      await writeAuditLog({
        actorUserId: req.userId!,
        actorRole: 'administrator',
        action: 'vision.enrollment.delete',
        objectType: 'face_enrollment',
        objectId: userId,
        oldValue: { deleted_count: result.deletedCount, user_id: userId },
        requestId: req.requestId,
      });

      sendSuccess(res, {
        user_id: userId,
        deleted_count: result.deletedCount,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
