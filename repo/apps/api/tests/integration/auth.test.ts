import request from 'supertest';
import { setupTestDb, teardownTestDb, getTestApp, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

beforeAll(async () => {
  const result = await setupTestDb();
  app = result.app;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  const db = getTestDb();
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.collection(col.name).deleteMany({});
  }
  // Re-bootstrap indexes after clearing
  const { bootstrapIndexes } = await import('../../src/config/db');
  await bootstrapIndexes();
});

describe('Auth API', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      // Get CSRF token first
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const res = await ag
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'testuser',
          password: 'TestPassword123',
          displayName: 'Test User',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.user.username).toBe('testuser');
      expect(res.body.data.user.displayName).toBe('Test User');
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject short password', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const res = await ag
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'testuser',
          password: 'short',
          displayName: 'Test User',
        });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });

    it('should reject duplicate username (case-insensitive)', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      await ag
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'testuser',
          password: 'TestPassword123',
          displayName: 'Test User',
        });

      const ag2 = request.agent(app);
      const csrfRes2 = await ag2.get('/api/v1/auth/csrf');
      const csrfToken2 = csrfRes2.body.data.csrfToken;

      const res = await ag2
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken2)
        .send({
          username: 'TESTUSER',
          password: 'AnotherPass123',
          displayName: 'Another User',
        });

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
    });

    it('should reject invalid username characters', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const res = await ag
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'test user!',
          password: 'TestPassword123',
          displayName: 'Test User',
        });

      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      await ag
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'logintest',
          password: 'LoginPassword123',
          displayName: 'Login Test',
        });
    });

    it('should login with valid credentials', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const res = await ag
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'logintest',
          password: 'LoginPassword123',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.user.username).toBe('logintest');
    });

    it('should reject invalid password', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const res = await ag
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'logintest',
          password: 'WrongPassword123',
        });

      expect(res.status).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const res = await ag
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'nonexistent',
          password: 'SomePassword123',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('CSRF Protection', () => {
    it('should reject POST without CSRF token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          password: 'TestPassword123',
          displayName: 'Test',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_MISSING');
    });
  });

  describe('Session Management', () => {
    it('should access protected routes with valid session', async () => {
      const ag = request.agent(app);
      const csrfRes = await ag.get('/api/v1/auth/csrf');
      const csrfToken = csrfRes.body.data.csrfToken;

      const regRes = await ag
        .post('/api/v1/auth/register')
        .set('x-csrf-token', csrfToken)
        .send({
          username: 'sessiontest',
          password: 'SessionPass1234',
          displayName: 'Session Test',
        });

      const cookies = regRes.headers['set-cookie'];

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', cookies);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.user.username).toBe('sessiontest');
    });

    it('should reject unauthenticated access to protected routes', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('should clear session and reject subsequent auth calls', async () => {
    // Register a user
    const ag1 = request.agent(app);
    const csrfRes1 = await ag1.get('/api/v1/auth/csrf');
    const csrfToken1 = csrfRes1.body.data.csrfToken;

    const regRes = await ag1
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken1)
      .send({
        username: 'logouttest',
        password: 'LogoutPass1234',
        displayName: 'Logout Test',
      });

    expect(regRes.status).toBe(200);
    const cookies = regRes.headers['set-cookie'] as unknown as string[];
    const csrfToken = regRes.body.data.csrfToken as string;

    // Confirm /auth/me works before logout
    const meBefore = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);
    expect(meBefore.status).toBe(200);

    // Call logout — reuse CSRF token from register (tokens are reusable)
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send();

    expect(logoutRes.status).toBe(200);

    // The session cookies returned after logout should invalidate the session.
    // Collect any Set-Cookie headers from the logout response; if present they
    // will clear the session cookie.  Then call /auth/me with those cookies.
    const logoutCookies =
      (logoutRes.headers['set-cookie'] as unknown as string[] | undefined) ?? cookies;

    const meAfter = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', logoutCookies);

    expect(meAfter.status).toBe(401);
  });
});
