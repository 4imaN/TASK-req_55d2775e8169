/**
 * Unit tests for middleware/csrf.ts
 *
 * Tests run without any DB connection.
 * The config module reads CSRF_SECRET from env — set by setup.ts.
 */

import './setup';

import {
  generateCsrfToken,
  verifyCsrfToken,
  csrfProtection,
} from '../../src/middleware/csrf';
import type { Request, Response, NextFunction } from 'express';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeMockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    // response.req is accessed inside sendError
    req: { requestId: 'test-req-id' } as unknown as Request,
  };
  return res as Response;
}

function makeMockReq(
  method: string,
  headerToken?: string,
  cookieToken?: string
): Request {
  return {
    method,
    headers: headerToken ? { 'x-csrf-token': headerToken } : {},
    cookies: cookieToken ? { csrf_token: cookieToken } : {},
  } as unknown as Request;
}

// ── generateCsrfToken ──────────────────────────────────────────────────────────

describe('generateCsrfToken()', () => {
  it('returns a non-empty string', () => {
    const token = generateCsrfToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('contains exactly one dot (token.signature format)', () => {
    const token = generateCsrfToken();
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(64); // 32 bytes → 64 hex chars
    expect(parts[1]).toHaveLength(64); // sha256 hex
  });

  it('produces a unique token on each call', () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });
});

// ── verifyCsrfToken ────────────────────────────────────────────────────────────

describe('verifyCsrfToken()', () => {
  it('returns true for a freshly generated token', () => {
    const token = generateCsrfToken();
    expect(verifyCsrfToken(token)).toBe(true);
  });

  it('returns false for a token with a tampered signature', () => {
    const [rawToken] = generateCsrfToken().split('.');
    const badToken = `${rawToken}.${'0'.repeat(64)}`;
    expect(verifyCsrfToken(badToken)).toBe(false);
  });

  it('returns false for a token with a tampered body', () => {
    const [, sig] = generateCsrfToken().split('.');
    const badToken = `${'a'.repeat(64)}.${sig}`;
    expect(verifyCsrfToken(badToken)).toBe(false);
  });

  it('returns false when there is no dot separator', () => {
    expect(verifyCsrfToken('nodottoken')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(verifyCsrfToken('')).toBe(false);
  });

  it('returns false for a token split into more than two parts', () => {
    expect(verifyCsrfToken('a.b.c')).toBe(false);
  });
});

// ── csrfProtection middleware ──────────────────────────────────────────────────

describe('csrfProtection() middleware', () => {
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    (next as jest.Mock).mockClear();
  });

  it('calls next() for GET requests without checking tokens', () => {
    const req = makeMockReq('GET');
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for HEAD requests', () => {
    const req = makeMockReq('HEAD');
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for OPTIONS requests', () => {
    const req = makeMockReq('OPTIONS');
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects POST when header token is missing', () => {
    const req = makeMockReq('POST', undefined, generateCsrfToken());
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('CSRF_MISSING');
  });

  it('rejects POST when cookie token is missing', () => {
    const req = makeMockReq('POST', generateCsrfToken(), undefined);
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('CSRF_MISSING');
  });

  it('rejects POST when header and cookie tokens do not match', () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    const req = makeMockReq('POST', t1, t2);
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('CSRF_MISMATCH');
  });

  it('rejects POST when matching tokens fail HMAC verification (tampered)', () => {
    // Build a token pair that match each other but have a bad signature
    const fakeToken = `${'a'.repeat(64)}.${'b'.repeat(64)}`;
    const req = makeMockReq('POST', fakeToken, fakeToken);
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('CSRF_INVALID');
  });

  it('calls next() for POST with a valid double-submit token pair', () => {
    const token = generateCsrfToken();
    const req = makeMockReq('POST', token, token);
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for PUT with a valid double-submit token pair', () => {
    const token = generateCsrfToken();
    const req = makeMockReq('PUT', token, token);
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for DELETE with a valid double-submit token pair', () => {
    const token = generateCsrfToken();
    const req = makeMockReq('DELETE', token, token);
    const res = makeMockRes();
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
