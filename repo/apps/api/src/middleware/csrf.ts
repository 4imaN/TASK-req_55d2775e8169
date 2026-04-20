import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { sendError } from '../utils/response';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf_token';

export function generateCsrfToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  const signature = crypto
    .createHmac('sha256', config.csrf.secret)
    .update(token)
    .digest('hex');
  return `${token}.${signature}`;
}

export function verifyCsrfToken(tokenWithSig: string): boolean {
  const parts = tokenWithSig.split('.');
  if (parts.length !== 2) return false;
  const [token, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', config.csrf.secret)
    .update(token)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSig, 'hex')
  );
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const headerToken = req.headers[CSRF_HEADER] as string;
  if (!headerToken) {
    sendError(res, 403, 'CSRF_MISSING', 'CSRF token required');
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!cookieToken) {
    sendError(res, 403, 'CSRF_MISSING', 'CSRF cookie missing');
    return;
  }

  // Double-submit: header and cookie must match exactly
  if (headerToken !== cookieToken) {
    sendError(res, 403, 'CSRF_MISMATCH', 'CSRF token mismatch');
    return;
  }

  // Then verify the HMAC signature of the shared token
  if (!verifyCsrfToken(headerToken)) {
    sendError(res, 403, 'CSRF_INVALID', 'Invalid CSRF token');
    return;
  }

  next();
}

export function setCsrfCookie(res: Response): string {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // Client needs to read this to send in header
    secure: process.env.NODE_ENV !== 'test',
    sameSite: 'lax',
    maxAge: 12 * 3600 * 1000, // 12 hours
    path: '/',
  });
  return token;
}
