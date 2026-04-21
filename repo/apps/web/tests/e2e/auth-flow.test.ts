/**
 * E2E — Auth Flow
 *
 * Validates the complete authentication user journey as the frontend
 * experiences it: Register → Verify session → View profile → Logout →
 * Confirm session is cleared.
 *
 * Mirrors what AuthContext.tsx + LoginPage.tsx + RegisterPage.tsx do
 * at the HTTP level, ensuring the API contract the frontend relies on
 * is upheld.
 */

import request from 'supertest';
import express from 'express';
import {
  setupE2eDb,
  teardownE2eDb,
  clearAndReindex,
  getCsrfToken,
  registerUser,
} from './setup';

let app: express.Application;

beforeAll(async () => {
  const result = await setupE2eDb();
  app = result.app;
});

afterAll(async () => {
  await teardownE2eDb();
});

beforeEach(async () => {
  await clearAndReindex();
});

// ── 1. Register ───────────────────────────────────────────────────────────────

describe('Auth flow — Registration (RegisterPage.tsx contract)', () => {
  it('registers a new user and returns session cookie + csrfToken', async () => {
    const { cookies, csrfToken, userId, user } = await registerUser(app, {
      username: 'e2e_auth_user',
      password: 'SecurePass12345',
      displayName: 'E2E Auth User',
    });

    // Response shape the frontend reads from AuthContext
    expect(userId).toBeDefined();
    expect(typeof userId).toBe('string');
    expect(user.username).toBe('e2e_auth_user');
    expect(user.displayName).toBe('E2E Auth User');
    expect(user.passwordHash).toBeUndefined(); // never exposed
    expect(typeof csrfToken).toBe('string');
    expect(csrfToken.length).toBeGreaterThan(0);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
  });

  it('rejects registration with a password shorter than 12 characters', async () => {
    const ag = request.agent(app);
    const csrf = await getCsrfToken(ag);

    const res = await ag
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrf)
      .send({ username: 'shortpassuser', password: 'short', displayName: 'Short Pass' });

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it('rejects a username with invalid characters (frontend enforces pattern)', async () => {
    const ag = request.agent(app);
    const csrf = await getCsrfToken(ag);

    const res = await ag
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrf)
      .send({ username: 'invalid user!', password: 'SecurePass12345', displayName: 'Bad User' });

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
  });

  it('rejects a duplicate username (case-insensitive)', async () => {
    await registerUser(app, {
      username: 'dupuser',
      password: 'SecurePass12345',
      displayName: 'Dup User',
    });

    const ag = request.agent(app);
    const csrf = await getCsrfToken(ag);
    const res = await ag
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrf)
      .send({ username: 'DUPUSER', password: 'SecurePass12345', displayName: 'Dup User 2' });

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
  });

  it('rejects registration without CSRF token (403)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'nocsrfuser', password: 'SecurePass12345', displayName: 'No CSRF' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_MISSING');
  });
});

// ── 2. Login ──────────────────────────────────────────────────────────────────

describe('Auth flow — Login (LoginPage.tsx contract)', () => {
  beforeEach(async () => {
    await registerUser(app, {
      username: 'loginuser',
      password: 'SecurePass12345',
      displayName: 'Login User',
    });
  });

  it('logs in with correct credentials and returns session + csrfToken', async () => {
    const ag = request.agent(app);
    const csrf = await getCsrfToken(ag);

    const res = await ag
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .send({ username: 'loginuser', password: 'SecurePass12345' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // AuthContext reads these fields
    expect(res.body.data.user.username).toBe('loginuser');
    expect(res.body.data.user.displayName).toBe('Login User');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.csrfToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects invalid password with 401', async () => {
    const ag = request.agent(app);
    const csrf = await getCsrfToken(ag);

    const res = await ag
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .send({ username: 'loginuser', password: 'WrongPassword123' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('rejects non-existent user with 401', async () => {
    const ag = request.agent(app);
    const csrf = await getCsrfToken(ag);

    const res = await ag
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf)
      .send({ username: 'nobody', password: 'SecurePass12345' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });
});

// ── 3. View Profile (AuthContext /auth/me) ────────────────────────────────────

describe('Auth flow — Session validation (AuthContext /auth/me contract)', () => {
  it('returns authenticated user from /auth/me with valid session cookie', async () => {
    const { cookies, userId } = await registerUser(app, {
      username: 'meuser',
      password: 'SecurePass12345',
      displayName: 'Me User',
    });

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);

    expect(meRes.status).toBe(200);
    expect(meRes.body.ok).toBe(true);

    // Shape the AuthContext parses
    const u = meRes.body.data.user;
    expect(u._id).toBe(userId);
    expect(u.username).toBe('meuser');
    expect(u.displayName).toBe('Me User');
    expect(u.passwordHash).toBeUndefined();
    expect(u.roles).toBeDefined();
    expect(Array.isArray(u.roles)).toBe(true);
    expect(u.reputationTier).toBeDefined();
    expect(u.isActive).toBe(true);
  });

  it('returns 401 from /auth/me without a session cookie', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('returns 401 from /auth/me with an invalid/expired cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'sid=invalid.garbage.value');

    expect(res.status).toBe(401);
  });
});

// ── 4. Logout ─────────────────────────────────────────────────────────────────

describe('Auth flow — Logout (AuthContext logout contract)', () => {
  it('clears the session and makes /auth/me return 401 afterwards', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'logoutuser',
      password: 'SecurePass12345',
      displayName: 'Logout User',
    });

    // Confirm session is valid pre-logout
    const meBefore = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);
    expect(meBefore.status).toBe(200);

    // Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // Use logout-response cookies (clears session) or original cookies
    const logoutCookies =
      (logoutRes.headers['set-cookie'] as unknown as string[] | undefined) ??
      cookies;

    // Session must now be cleared
    const meAfter = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', logoutCookies);

    expect(meAfter.status).toBe(401);
  });

  it('requires CSRF token for logout', async () => {
    const { cookies } = await registerUser(app, {
      username: 'logoutnocsrf',
      password: 'SecurePass12345',
      displayName: 'Logout No CSRF',
    });

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies);
    // No x-csrf-token header

    expect(res.status).toBe(403);
  });
});

// ── 5. CSRF Token endpoint (api.ts fetchCsrfToken contract) ───────────────────

describe('Auth flow — CSRF token endpoint (api.ts fetchCsrfToken contract)', () => {
  it('returns a csrfToken from GET /auth/csrf', async () => {
    const res = await request(app).get('/api/v1/auth/csrf');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // api.ts reads: data.data.csrfToken
    expect(res.body.data.csrfToken).toBeDefined();
    expect(typeof res.body.data.csrfToken).toBe('string');
    expect(res.body.data.csrfToken.length).toBeGreaterThan(0);
  });

  it('sets a cookie alongside the CSRF token', async () => {
    const res = await request(app).get('/api/v1/auth/csrf');
    expect(res.headers['set-cookie']).toBeDefined();
  });
});
