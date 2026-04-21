/**
 * Unit tests for middleware/auth.ts
 *
 * The authenticate() and optionalAuth() functions call validateSession() from
 * session.service.ts which hits the DB.  We mock the session service module so
 * no DB connection is needed.
 */

import './setup';

import type { Request, Response, NextFunction } from 'express';
import {
  authenticate,
  requireRole,
  requireStaff,
  optionalAuth,
  hasRole,
  isAdmin,
} from '../../src/middleware/auth';

// ── mock session.service ───────────────────────────────────────────────────────

jest.mock('../../src/services/session.service', () => ({
  validateSession: jest.fn(),
}));

import { validateSession } from '../../src/services/session.service';
const mockValidateSession = validateSession as jest.Mock;

// ── helpers ────────────────────────────────────────────────────────────────────

function makeMockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    req: { requestId: 'test-req-id' } as unknown as Request,
  };
  return res as Response;
}

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return {
    cookies: {},
    headers: {},
    method: 'GET',
    ...overrides,
  } as unknown as Request;
}

function makeNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

// ── authenticate ───────────────────────────────────────────────────────────────

describe('authenticate()', () => {
  beforeEach(() => {
    mockValidateSession.mockReset();
  });

  it('rejects when no session_token cookie is present', async () => {
    const req = makeMockReq({ cookies: {} });
    const res = makeMockRes();
    const next = makeNext();

    authenticate(req, res, next);

    await Promise.resolve(); // flush micro-queue
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects when validateSession returns null (expired session)', async () => {
    mockValidateSession.mockResolvedValue(null);
    const req = makeMockReq({ cookies: { session_token: 'bad-token' } });
    const res = makeMockRes();
    const next = makeNext();

    authenticate(req, res, next);
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects when validateSession rejects with an error', async () => {
    mockValidateSession.mockRejectedValue(new Error('DB error'));
    const req = makeMockReq({ cookies: { session_token: 'some-token' } });
    const res = makeMockRes();
    const next = makeNext();

    authenticate(req, res, next);
    // Flush enough microtask turns to let the rejected promise propagate
    // through the .then().catch() chain in authenticate().
    await new Promise((r) => setImmediate(r));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('populates req and calls next() when session is valid', async () => {
    mockValidateSession.mockResolvedValue({
      userId: 'user-1',
      sessionId: 'session-1',
      roles: ['member'],
    });
    const req = makeMockReq({ cookies: { session_token: 'valid-token' } });
    const res = makeMockRes();
    const next = makeNext();

    authenticate(req, res, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).userId).toBe('user-1');
    expect((req as any).sessionId).toBe('session-1');
    expect((req as any).userRoles).toEqual(['member']);
  });
});

// ── requireRole ───────────────────────────────────────────────────────────────

describe('requireRole()', () => {
  it('rejects when req has no userId (not authenticated)', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = makeNext();

    requireRole('moderator')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects when user does not have the required role', () => {
    const req = makeMockReq();
    (req as any).userId = 'user-1';
    (req as any).userRoles = ['member'];
    const res = makeMockRes();
    const next = makeNext();

    requireRole('moderator')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('calls next when user has the required role', () => {
    const req = makeMockReq();
    (req as any).userId = 'user-1';
    (req as any).userRoles = ['moderator'];
    const res = makeMockRes();
    const next = makeNext();

    requireRole('moderator')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows administrator when the allowed role is moderator (admin inherits all)', () => {
    const req = makeMockReq();
    (req as any).userId = 'admin-1';
    (req as any).userRoles = ['administrator'];
    const res = makeMockRes();
    const next = makeNext();

    requireRole('moderator')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows administrator for creator role', () => {
    const req = makeMockReq();
    (req as any).userId = 'admin-1';
    (req as any).userRoles = ['administrator'];
    const res = makeMockRes();
    const next = makeNext();

    requireRole('creator')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepts first matching role from an allowedRoles list', () => {
    const req = makeMockReq();
    (req as any).userId = 'user-1';
    (req as any).userRoles = ['creator'];
    const res = makeMockRes();
    const next = makeNext();

    requireRole('moderator', 'creator')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ── requireStaff ──────────────────────────────────────────────────────────────

describe('requireStaff()', () => {
  it('rejects when userId is absent', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = makeNext();

    requireStaff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a plain member', () => {
    const req = makeMockReq();
    (req as any).userId = 'user-1';
    (req as any).userRoles = ['member'];
    const res = makeMockRes();
    const next = makeNext();

    requireStaff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('accepts a creator', () => {
    const req = makeMockReq();
    (req as any).userId = 'user-1';
    (req as any).userRoles = ['creator'];
    const res = makeMockRes();
    const next = makeNext();

    requireStaff(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepts a moderator', () => {
    const req = makeMockReq();
    (req as any).userId = 'user-1';
    (req as any).userRoles = ['moderator'];
    const res = makeMockRes();
    const next = makeNext();

    requireStaff(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepts an administrator', () => {
    const req = makeMockReq();
    (req as any).userId = 'admin-1';
    (req as any).userRoles = ['administrator'];
    const res = makeMockRes();
    const next = makeNext();

    requireStaff(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ── optionalAuth ──────────────────────────────────────────────────────────────

describe('optionalAuth()', () => {
  beforeEach(() => {
    mockValidateSession.mockReset();
  });

  it('calls next() without error when no token cookie exists', async () => {
    const req = makeMockReq({ cookies: {} });
    const res = makeMockRes();
    const next = makeNext();

    optionalAuth(req, res, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).userId).toBeUndefined();
  });

  it('populates req when a valid session exists', async () => {
    mockValidateSession.mockResolvedValue({
      userId: 'user-2',
      sessionId: 'session-2',
      roles: ['member'],
    });

    const req = makeMockReq({ cookies: { session_token: 'valid' } });
    const res = makeMockRes();
    const next = makeNext();

    optionalAuth(req, res, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).userId).toBe('user-2');
  });

  it('still calls next() even when validateSession rejects', async () => {
    mockValidateSession.mockRejectedValue(new Error('network error'));

    const req = makeMockReq({ cookies: { session_token: 'any' } });
    const res = makeMockRes();
    const next = makeNext();

    optionalAuth(req, res, next);
    await new Promise((r) => setImmediate(r));

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).userId).toBeUndefined();
  });
});

// ── hasRole & isAdmin helpers ─────────────────────────────────────────────────

describe('hasRole()', () => {
  it('returns true when roles contains the target role', () => {
    expect(hasRole(['moderator'], 'moderator')).toBe(true);
  });

  it('returns false when roles does not contain the target role', () => {
    expect(hasRole(['member'], 'moderator')).toBe(false);
  });

  it('returns true for any role when administrator is present', () => {
    expect(hasRole(['administrator'], 'moderator')).toBe(true);
    expect(hasRole(['administrator'], 'creator')).toBe(true);
    expect(hasRole(['administrator'], 'member')).toBe(true);
  });

  it('returns false for an empty roles array', () => {
    expect(hasRole([], 'moderator')).toBe(false);
  });
});

describe('isAdmin()', () => {
  it('returns true when administrator is present', () => {
    expect(isAdmin(['administrator'])).toBe(true);
    expect(isAdmin(['member', 'administrator'])).toBe(true);
  });

  it('returns false when administrator is absent', () => {
    expect(isAdmin(['moderator'])).toBe(false);
    expect(isAdmin([])).toBe(false);
  });
});
