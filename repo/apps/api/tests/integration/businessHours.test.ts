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

describe('Business Hours API', () => {
  describe('GET /api/v1/business-hours', () => {
    it('returns site hours', async () => {
      const db = getTestDb();
      await db.collection('business_hours').insertOne({
        scope: 'site',
        scopeId: null,
        dayOfWeek: 1,
        openTime: '08:00',
        closeTime: '20:00',
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { cookies } = await registerAndLogin('bhget1', 'BhPass12345!', 'BH Getter');

      const res = await request(app)
        .get('/api/v1/business-hours?scope=site')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects invalid scope', async () => {
      const { cookies } = await registerAndLogin('bhget2', 'BhPass12345!', 'BH Getter 2');

      const res = await request(app)
        .get('/api/v1/business-hours?scope=invalid')
        .set('Cookie', cookies);

      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/business-hours', () => {
    it('creator can create business hours', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bhcreator1', 'BhPass12345!', 'BH Creator', ['creator']
      );

      const res = await request(app)
        .post('/api/v1/business-hours')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          scope: 'site',
          dayOfWeek: 1,
          openTime: '09:00',
          closeTime: '21:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.openTime).toBe('09:00');
      expect(res.body.data.closeTime).toBe('21:00');
    });

    it('rejects creation by regular user with 403', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bhregular1', 'BhPass12345!', 'BH Regular'
      );

      const res = await request(app)
        .post('/api/v1/business-hours')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ scope: 'site', dayOfWeek: 2, openTime: '08:00', closeTime: '18:00' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/business-hours/effective', () => {
    it('returns effective hours with override precedence', async () => {
      const db = getTestDb();

      const zoneRes = await db.collection('zones').insertOne({
        name: 'Effective Zone',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
      const zoneId = zoneRes.insertedId.toString();

      const roomRes = await db.collection('rooms').insertOne({
        zoneId,
        name: 'Effective Room',
        capacity: 4,
        amenities: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
      const roomId = roomRes.insertedId.toString();

      // Site-level hours for Monday
      await db.collection('business_hours').insertOne({
        scope: 'site',
        scopeId: null,
        dayOfWeek: 1,
        openTime: '08:00',
        closeTime: '20:00',
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Room-level override for Monday (narrower window)
      await db.collection('business_hours').insertOne({
        scope: 'room',
        scopeId: roomId,
        dayOfWeek: 1,
        openTime: '10:00',
        closeTime: '18:00',
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { cookies } = await registerAndLogin('bheffective1', 'BhPass12345!', 'BH Effective');

      const res = await request(app)
        .get(`/api/v1/business-hours/effective?roomId=${roomId}&zoneId=${zoneId}&dayOfWeek=1`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // Room-level override should take precedence
      expect(res.body.data.openTime).toBe('10:00');
      expect(res.body.data.closeTime).toBe('18:00');
    });

    it('requires roomId, zoneId, and dayOfWeek', async () => {
      const { cookies } = await registerAndLogin('bheffective2', 'BhPass12345!', 'BH Effective 2');

      const res = await request(app)
        .get('/api/v1/business-hours/effective?roomId=someid')
        .set('Cookie', cookies);

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/v1/business-hours/:id', () => {
    it('creator can delete a business hours entry', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'bhdelete1', 'BhPass12345!', 'BH Deleter', ['creator']
      );

      // Create entry first
      const createRes = await request(app)
        .post('/api/v1/business-hours')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ scope: 'site', dayOfWeek: 3, openTime: '07:00', closeTime: '19:00' });

      expect(createRes.status).toBe(200);
      const entryId = createRes.body.data._id as string;

      const deleteRes = await request(app)
        .delete(`/api/v1/business-hours/${entryId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.deleted).toBe(true);
    });
  });
});
