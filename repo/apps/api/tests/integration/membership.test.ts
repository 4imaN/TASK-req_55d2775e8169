import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function createAgent() {
  return request.agent(app);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

describe('Membership API', () => {
  describe('GET /api/v1/membership/me', () => {
    it('returns own membership account', async () => {
      const { cookies } = await registerAndLogin('memme1', 'MemPass1234!', 'Mem Me 1');

      const res = await request(app)
        .get('/api/v1/membership/me')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.account).toHaveProperty('pointsBalance');
      expect(res.body.data.account).toHaveProperty('walletBalanceCents');
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/membership/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/membership/tiers', () => {
    it('lists membership tiers', async () => {
      const db = getTestDb();
      await db.collection('membership_tiers').insertOne({
        name: 'Gold',
        description: 'Gold tier benefits',
        benefits: { extraTime: true },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const { cookies } = await registerAndLogin('memtiers1', 'MemPass1234!', 'Mem Tiers 1');

      const res = await request(app)
        .get('/api/v1/membership/tiers')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/v1/membership/tiers', () => {
    it('admin can create a tier', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'memadmin1', 'MemPass1234!', 'Mem Admin 1', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/membership/tiers')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Platinum', description: 'Top tier', benefits: { priority: true } });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.name).toBe('Platinum');
    });

    it('returns 403 for non-admin', async () => {
      const { cookies, csrfToken } = await registerAndLogin('memreg1', 'MemPass1234!', 'Mem Reg 1');

      const res = await request(app)
        .post('/api/v1/membership/tiers')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Unauthorized Tier' });

      expect(res.status).toBe(403);
    });

    it('requires tier name', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'memadmin2', 'MemPass1234!', 'Mem Admin 2', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/membership/tiers')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ description: 'No name tier' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/v1/membership/tiers/:id', () => {
    it('updates a tier with correct version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'memadmin3', 'MemPass1234!', 'Mem Admin 3', ['administrator']
      );

      const createRes = await request(app)
        .post('/api/v1/membership/tiers')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Silver', description: 'Silver tier' });

      expect(createRes.status).toBe(201);
      const tierId = createRes.body.data._id as string;
      const version = createRes.body.data.version as number;

      const updateRes = await request(app)
        .put(`/api/v1/membership/tiers/${tierId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Silver Plus', version });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Silver Plus');
    });
  });

  describe('PUT /api/v1/membership/assign', () => {
    it('admin can assign a tier to a user', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'memadmin4', 'MemPass1234!', 'Mem Admin 4', ['administrator']
      );
      const { userId } = await registerAndLogin('memtarget1', 'MemPass1234!', 'Mem Target 1');

      // Create a tier first
      const tierRes = await request(app)
        .post('/api/v1/membership/tiers')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Bronze', description: 'Bronze tier' });

      expect(tierRes.status).toBe(201);
      const tierId = tierRes.body.data._id as string;

      const assignRes = await request(app)
        .put('/api/v1/membership/assign')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ userId, tierId });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.tierId).toBe(tierId);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'memreg2', 'MemPass1234!', 'Mem Reg 2'
      );

      const res = await request(app)
        .put('/api/v1/membership/assign')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ userId, tierId: new ObjectId().toString() });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/membership/members', () => {
    it('admin can list member accounts', async () => {
      const { cookies } = await registerAndLogin(
        'memadmin5', 'MemPass1234!', 'Mem Admin 5', ['administrator']
      );
      await registerAndLogin('memmember1', 'MemPass1234!', 'Mem Member 1');

      const res = await request(app)
        .get('/api/v1/membership/members')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('returns 403 for non-admin', async () => {
      const { cookies } = await registerAndLogin('memreg3', 'MemPass1234!', 'Mem Reg 3');

      const res = await request(app)
        .get('/api/v1/membership/members')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });
});
