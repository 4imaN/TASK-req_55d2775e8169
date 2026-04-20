import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function createAgent() {
  return request.agent(app);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getCsrf(agent?: ReturnType<typeof request.agent>): Promise<string> {
  const res = await (agent || createAgent()).get('/api/v1/auth/csrf');
  return res.body.data.csrfToken as string;
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ cookies: string[]; csrfToken: string; userId: string }> {
  const ag = createAgent();
  const csrf1 = await getCsrf(ag);
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

  const csrf2 = await getCsrf(ag);
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

describe('Policy API', () => {
  describe('GET /api/v1/policies', () => {
    it('admin can list policy versions', async () => {
      const db = getTestDb();
      await db.collection('policy_versions').insertOne({
        policyArea: 'cancellation',
        settings: { gracePeriodMinutes: 15 },
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
        createdByUserId: new ObjectId().toString(),
        createdAt: new Date(),
      });

      const { cookies } = await registerAndLogin(
        'polyadmin1', 'PolyPass1234!', 'Policy Admin 1', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/policies')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('returns 403 for non-admin', async () => {
      const { cookies } = await registerAndLogin('polyreg1', 'PolyPass1234!', 'Policy Reg 1');

      const res = await request(app)
        .get('/api/v1/policies')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/policies');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/policies', () => {
    it('admin can create a new policy version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'polyadmin2', 'PolyPass1234!', 'Policy Admin 2', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/policies')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          policyArea: 'no_show',
          settings: { gracePeriodMinutes: 10, penaltyCents: 500 },
          effectiveAt: '2026-06-01T00:00:00Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.policyArea).toBe('no_show');
      expect(res.body.data.settings.penaltyCents).toBe(500);
    });

    it('rejects missing policyArea', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'polyadmin3', 'PolyPass1234!', 'Policy Admin 3', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/policies')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          settings: { gracePeriodMinutes: 5 },
          effectiveAt: '2026-07-01T00:00:00Z',
        });

      expect(res.status).toBe(422);
    });

    it('rejects missing effectiveAt', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'polyadmin4', 'PolyPass1234!', 'Policy Admin 4', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/policies')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          policyArea: 'cancellation',
          settings: { gracePeriodMinutes: 20 },
        });

      expect(res.status).toBe(422);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies, csrfToken } = await registerAndLogin('polyreg2', 'PolyPass1234!', 'Policy Reg 2');

      const res = await request(app)
        .post('/api/v1/policies')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          policyArea: 'cancellation',
          settings: {},
          effectiveAt: '2026-08-01T00:00:00Z',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/policies/:id', () => {
    it('admin can fetch a single policy version by id', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'polyadmin5', 'PolyPass1234!', 'Policy Admin 5', ['administrator']
      );

      const createRes = await request(app)
        .post('/api/v1/policies')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          policyArea: 'booking_lead_time',
          settings: { minLeadTimeMinutes: 30 },
          effectiveAt: '2026-09-01T00:00:00Z',
        });

      expect(createRes.status).toBe(201);
      const policyId = createRes.body.data._id as string;

      const res = await request(app)
        .get(`/api/v1/policies/${policyId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data.policyArea).toBe('booking_lead_time');
    });

    it('returns 404 for non-existent policy id', async () => {
      const { cookies } = await registerAndLogin(
        'polyadmin6', 'PolyPass1234!', 'Policy Admin 6', ['administrator']
      );
      const fakeId = new ObjectId().toString();

      const res = await request(app)
        .get(`/api/v1/policies/${fakeId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(404);
    });

    it('returns 403 for non-admin', async () => {
      const db = getTestDb();
      const inserted = await db.collection('policy_versions').insertOne({
        policyArea: 'test_policy',
        settings: {},
        effectiveAt: new Date(),
        createdByUserId: new ObjectId().toString(),
        createdAt: new Date(),
      });
      const policyId = inserted.insertedId.toString();

      const { cookies } = await registerAndLogin('polyreg3', 'PolyPass1234!', 'Policy Reg 3');

      const res = await request(app)
        .get(`/api/v1/policies/${policyId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });
});
