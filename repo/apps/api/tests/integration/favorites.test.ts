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

async function insertRoom(): Promise<string> {
  const db = getTestDb();
  const zoneRes = await db.collection('zones').insertOne({
    name: 'Fav Zone',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const roomRes = await db.collection('rooms').insertOne({
    zoneId: zoneRes.insertedId.toString(),
    name: 'Fav Room',
    capacity: 4,
    amenities: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return roomRes.insertedId.toString();
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

describe('Favorites API', () => {
  describe('POST /api/v1/favorites', () => {
    it('adds a room to favorites', async () => {
      const { cookies, csrfToken } = await registerAndLogin('favuser1', 'FavPass1234!', 'Fav User 1');
      const roomId = await insertRoom();

      const res = await request(app)
        .post('/api/v1/favorites')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.favorited).toBe(true);
    });

    it('is idempotent — adding same room twice does not error', async () => {
      const { cookies, csrfToken } = await registerAndLogin('favuser2', 'FavPass1234!', 'Fav User 2');
      const roomId = await insertRoom();

      const res1 = await request(app)
        .post('/api/v1/favorites')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId });

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post('/api/v1/favorites')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId });

      expect(res2.status).toBe(200);
      expect(res2.body.data.favorited).toBe(true);
    });

    it('rejects missing roomId', async () => {
      const { cookies, csrfToken } = await registerAndLogin('favuser3', 'FavPass1234!', 'Fav User 3');

      const res = await request(app)
        .post('/api/v1/favorites')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/v1/favorites', () => {
    it('returns favorites with room data', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('favuser4', 'FavPass1234!', 'Fav User 4');
      const roomId = await insertRoom();

      await request(app)
        .post('/api/v1/favorites')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId });

      const res = await request(app)
        .get('/api/v1/favorites')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
    });

    it('returns empty array when no favorites', async () => {
      const { cookies } = await registerAndLogin('favuser5', 'FavPass1234!', 'Fav User 5');

      const res = await request(app)
        .get('/api/v1/favorites')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('DELETE /api/v1/favorites/:roomId', () => {
    it('removes a room from favorites', async () => {
      const { cookies, csrfToken } = await registerAndLogin('favuser6', 'FavPass1234!', 'Fav User 6');
      const roomId = await insertRoom();

      await request(app)
        .post('/api/v1/favorites')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId });

      const deleteRes = await request(app)
        .delete(`/api/v1/favorites/${roomId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.unfavorited).toBe(true);

      // Verify it is gone
      const listRes = await request(app)
        .get('/api/v1/favorites')
        .set('Cookie', cookies);

      expect(listRes.body.data.length).toBe(0);
    });
  });
});
