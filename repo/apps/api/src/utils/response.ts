import { Response, Request } from 'express';

export function sendSuccess(res: Response, data: unknown, meta?: Record<string, unknown>): void {
  const req = res.req as Request;
  res.json({
    ok: true,
    data,
    meta: {
      requestId: req.requestId,
      ...meta,
    },
  });
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  const req = res.req as Request;
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      details: details || {},
      requestId: req.requestId,
    },
  });
}

export function sendPaginated(
  res: Response,
  data: unknown[],
  total: number,
  page: number,
  pageSize: number
): void {
  const req = res.req as Request;
  res.json({
    ok: true,
    data,
    meta: {
      requestId: req.requestId,
      page,
      pageSize,
      total,
    },
  });
}
