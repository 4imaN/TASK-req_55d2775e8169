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

async function insertReservation(userId: string): Promise<string> {
  const db = getTestDb();

  const zoneRes = await db.collection('zones').insertOne({
    name: 'Share Zone',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const zoneId = zoneRes.insertedId.toString();

  const roomRes = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Share Room',
    capacity: 4,
    amenities: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const roomId = roomRes.insertedId.toString();

  const resResult = await db.collection('reservations').insertOne({
    userId,
    roomId,
    zoneId,
    startAtUtc: new Date('2026-05-01T10:00:00Z'),
    endAtUtc: new Date('2026-05-01T11:00:00Z'),
    status: 'confirmed',
    idempotencyKey: `share-test-${new ObjectId().toString()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return resResult.insertedId.toString();
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

describe('Share Links API', () => {
  describe('POST /api/v1/share-links', () => {
    it('creates a share link for own reservation', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'shareuser1', 'SharePass1234!', 'Share User 1'
      );
      const reservationId = await insertReservation(userId);

      const res = await request(app)
        .post('/api/v1/share-links')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reservationId });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.expiresAt).toBeDefined();
    });

    it("returns 403 when attempting to share another user's reservation", async () => {
      const { userId: otherUserId } = await registerAndLogin(
        'shareother1', 'SharePass1234!', 'Share Other 1'
      );
      const { cookies, csrfToken } = await registerAndLogin(
        'shareuser2', 'SharePass1234!', 'Share User 2'
      );
      const reservationId = await insertReservation(otherUserId);

      const res = await request(app)
        .post('/api/v1/share-links')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reservationId });

      expect(res.status).toBe(403);
    });

    it('requires reservationId', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'shareuser3', 'SharePass1234!', 'Share User 3'
      );

      const res = await request(app)
        .post('/api/v1/share-links')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/v1/share-links/:token', () => {
    it('returns shared reservation info by token', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'shareuser4', 'SharePass1234!', 'Share User 4'
      );
      const reservationId = await insertReservation(userId);

      const createRes = await request(app)
        .post('/api/v1/share-links')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reservationId });

      expect(createRes.status).toBe(200);
      const token = createRes.body.data.token as string;

      // Any authenticated user can look up the token
      const { cookies: otherCookies } = await registerAndLogin(
        'shareviewer1', 'ViewPass1234!', 'Share Viewer 1'
      );

      const getRes = await request(app)
        .get(`/api/v1/share-links/${token}`)
        .set('Cookie', otherCookies);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.startAtUtc).toBeDefined();
      expect(getRes.body.data.status).toBeDefined();
    });

    it('returns 404 for non-existent token', async () => {
      const { cookies } = await registerAndLogin('shareuser5', 'SharePass1234!', 'Share User 5');

      const res = await request(app)
        .get('/api/v1/share-links/nonexistenttoken123456')
        .set('Cookie', cookies);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/share-links/:token', () => {
    it('revokes a share link', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'shareuser6', 'SharePass1234!', 'Share User 6'
      );
      const reservationId = await insertReservation(userId);

      const createRes = await request(app)
        .post('/api/v1/share-links')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reservationId });

      expect(createRes.status).toBe(200);
      const token = createRes.body.data.token as string;

      const deleteRes = await request(app)
        .delete(`/api/v1/share-links/${token}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.revoked).toBe(true);

      // Verify the token no longer resolves
      const getRes = await request(app)
        .get(`/api/v1/share-links/${token}`)
        .set('Cookie', cookies);

      expect(getRes.status).toBe(404);
    });
  });
});
