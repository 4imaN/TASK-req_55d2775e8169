import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

// ── Helpers ────────────────────────────────────────────────────────────────────

function createAgent() {
  return request.agent(app);
}

async function getCsrf(agent?: ReturnType<typeof request.agent>): Promise<string | { token: string; csrfCookies: string[] }> {
  if (agent) {
    const res = await agent.get('/api/v1/auth/csrf');
    return res.body.data.csrfToken as string;
  }
  const res = await request(app).get('/api/v1/auth/csrf');
  return {
    token: res.body.data.csrfToken as string,
    csrfCookies: (res.headers['set-cookie'] as unknown as string[]) || [],
  };
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ cookies: string[]; csrfToken: string; userId: string }> {
  const ag = createAgent();
  const csrf1 = await getCsrf(ag) as string;
  const regRes = await ag
    .post('/api/v1/auth/register')
    .set('x-csrf-token', csrf1)
    .send({ username, password, displayName });

  expect(regRes.status).toBe(200);
  const userId = regRes.body.data.user._id as string;

  if (roles && roles.length > 0) {
    const db = getTestDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles } }
    );
  }

  const csrf2 = await getCsrf(ag) as string;
  const loginRes = await ag
    .post('/api/v1/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ username, password });

  expect(loginRes.status).toBe(200);
  const cookies = loginRes.headers['set-cookie'] as unknown as string[];
  const csrfToken = loginRes.body.data.csrfToken as string;

  return { cookies, csrfToken, userId };
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

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
  const { bootstrapIndexes } = await import('../../src/config/db');
  await bootstrapIndexes();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Blacklist API', () => {
  describe('POST /api/v1/blacklist', () => {
    it('admin can create a manual blacklist entry', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bladmin1', 'BlAdmin1234!', 'BL Admin 1', ['administrator']
      );
      const { userId } = await registerAndLogin('bltarget1', 'BlTarget1234!', 'BL Target 1');

      const res = await request(app)
        .post('/api/v1/blacklist')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ userId, reason: 'Repeated policy violations' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'blreg1', 'BlReg1234!xx', 'BL Reg 1'
      );

      const res = await request(app)
        .post('/api/v1/blacklist')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ userId, reason: 'Unauthorized attempt' });

      expect(res.status).toBe(403);
    });

    it('requires userId and reason', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bladmin2', 'BlAdmin1234!', 'BL Admin 2', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/blacklist')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reason: 'Missing userId' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/blacklist', () => {
    it('admin can list blacklist actions', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bladmin3', 'BlAdmin1234!', 'BL Admin 3', ['administrator']
      );
      const { userId } = await registerAndLogin('bltarget2', 'BlTarget1234!', 'BL Target 2');

      // Create a blacklist entry first
      await request(app)
        .post('/api/v1/blacklist')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ userId, reason: 'No-show pattern detected' });

      const res = await request(app)
        .get('/api/v1/blacklist')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies } = await registerAndLogin('blreg2', 'BlReg1234!xx', 'BL Reg 2');

      const res = await request(app)
        .get('/api/v1/blacklist')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/blacklist/:userId/clear', () => {
    it('admin can clear a blacklist entry', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bladmin4', 'BlAdmin1234!', 'BL Admin 4', ['administrator']
      );
      const { userId } = await registerAndLogin('bltarget3', 'BlTarget1234!', 'BL Target 3');

      // Blacklist the user first
      await request(app)
        .post('/api/v1/blacklist')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ userId, reason: 'Policy violation to clear' });

      const clearRes = await request(app)
        .post(`/api/v1/blacklist/${userId}/clear`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send();

      expect(clearRes.status).toBe(200);
      expect(clearRes.body.ok).toBe(true);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'blreg3', 'BlReg1234!xx', 'BL Reg 3'
      );

      const res = await request(app)
        .post(`/api/v1/blacklist/${userId}/clear`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send();

      expect(res.status).toBe(403);
    });
  });
});
