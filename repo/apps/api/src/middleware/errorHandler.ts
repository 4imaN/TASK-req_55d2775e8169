import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';
import {
  ValidationError,
  ConflictError,
  AuthError,
  ForbiddenError,
  NotFoundError,
} from '../services/auth.service';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Log structured error (never log sensitive data)
  console.error(JSON.stringify({
    level: 'error',
    domain: 'api',
    requestId: req.requestId,
    error: err.name,
    message: err.message,
    path: req.path,
    method: req.method,
  }));

  if (err instanceof ValidationError) {
    sendError(res, 422, 'VALIDATION_ERROR', err.message);
    return;
  }

  if (err instanceof ConflictError) {
    sendError(res, 409, 'CONFLICT', err.message);
    return;
  }

  if (err instanceof AuthError) {
    sendError(res, 401, 'AUTH_ERROR', err.message);
    return;
  }

  if (err instanceof ForbiddenError) {
    sendError(res, 403, 'FORBIDDEN', err.message);
    return;
  }

  if (err instanceof NotFoundError) {
    sendError(res, 404, 'NOT_FOUND', err.message);
    return;
  }

  // Multer errors
  if (err.name === 'MulterError') {
    sendError(res, 422, 'UPLOAD_ERROR', err.message);
    return;
  }

  // Default
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
}
