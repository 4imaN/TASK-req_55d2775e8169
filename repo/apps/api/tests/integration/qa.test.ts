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
  const agent = createAgent();
  const csrf1 = await getCsrf(agent) as string;
  const regRes = await agent
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

  const csrf2 = await getCsrf(agent) as string;
  const loginRes = await agent
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
    name: 'QA Zone',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const roomRes = await db.collection('rooms').insertOne({
    zoneId: zoneRes.insertedId.toString(),
    name: 'QA Room',
    capacity: 6,
    amenities: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return roomRes.insertedId.toString();
}

/** Seed a completed reservation so the user is eligible to post QA threads */
async function seedEligibleReservation(userId: string, roomId: string): Promise<void> {
  const db = getTestDb();
  const room = await db.collection('rooms').findOne({ _id: new ObjectId(roomId) }) as any;
  await db.collection('reservations').insertOne({
    userId,
    roomId,
    zoneId: room?.zoneId || new ObjectId().toString(),
    startAtUtc: new Date('2026-04-01T10:00:00Z'),
    endAtUtc: new Date('2026-04-01T11:00:00Z'),
    status: 'completed',
    idempotencyKey: `qa-elig-${userId}-${roomId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
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

describe('QA Threads API', () => {
  describe('POST /api/v1/qa-threads', () => {
    it('authenticated user with eligible reservation can create a thread', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser1', 'QaPass12345!', 'QA User 1');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const res = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          title: 'What is the Wi-Fi password for this room?',
          body: 'I need to connect my laptop to present during my session.',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.title).toBe('What is the Wi-Fi password for this room?');
      expect(res.body.data.roomId).toBe(roomId);
    });

    it('requires roomId, title, and body', async () => {
      const { cookies, csrfToken } = await registerAndLogin('qauser2', 'QaPass12345!', 'QA User 2');

      const res = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'Missing roomId and body' });

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const roomId = await insertRoom();
      const ag = createAgent();
      const csrfToken = await getCsrf(ag) as string;

      const res = await ag
        .post('/api/v1/qa-threads')
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Unauth thread attempt here?', body: 'Body text for thread.' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/qa-threads', () => {
    it('lists threads filtered by roomId', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser3', 'QaPass12345!', 'QA User 3');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Room setup questions for everyone here?', body: 'Please share any tips.' });

      await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Parking availability near this building?', body: 'Looking for parking info.' });

      const res = await request(app)
        .get(`/api/v1/qa-threads?roomId=${roomId}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('requires roomId query parameter', async () => {
      const res = await request(app).get('/api/v1/qa-threads');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/qa-threads/:id/posts', () => {
    it('creates a reply post on a thread', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser4', 'QaPass12345!', 'QA User 4');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'How do I adjust the thermostat in here?', body: 'Room feels very cold.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const postRes = await request(app)
        .post(`/api/v1/qa-threads/${threadId}/posts`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ body: 'The thermostat is next to the entrance door on the left.' });

      expect(postRes.status).toBe(201);
      expect(postRes.body.ok).toBe(true);
      expect(postRes.body.data.threadId).toBe(threadId);
    });

    it('requires body', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser5', 'QaPass12345!', 'QA User 5');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Empty reply body test question here?', body: 'Testing empty replies now.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const res = await request(app)
        .post(`/api/v1/qa-threads/${threadId}/posts`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/v1/qa-threads/:id/pin', () => {
    it('moderator can pin a thread', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser6', 'QaPass12345!', 'QA User 6');
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'qamod1', 'QaMod1234!xx', 'QA Mod 1', ['moderator']
      );
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Important announcement to pin for everyone.', body: 'Please read this carefully.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const res = await request(app)
        .put(`/api/v1/qa-threads/${threadId}/pin`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ isPinned: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isPinned).toBe(true);
    });

    it('regular user cannot pin a thread (403)', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser7', 'QaPass12345!', 'QA User 7');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Attempt to pin without permission here?', body: 'Should not be allowed.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const res = await request(app)
        .put(`/api/v1/qa-threads/${threadId}/pin`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ isPinned: true });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/qa-threads/:id/collapse', () => {
    it('moderator can collapse a thread', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser8', 'QaPass12345!', 'QA User 8');
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'qamod2', 'QaMod1234!xx', 'QA Mod 2', ['moderator']
      );
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Thread that will be collapsed by moderator.', body: 'Content being moderated here.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const res = await request(app)
        .put(`/api/v1/qa-threads/${threadId}/collapse`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('collapsed');
    });
  });

  describe('GET /api/v1/qa-threads/:id', () => {
    it('returns thread by id with expected fields', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser9', 'QaPass12345!', 'QA User 9');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Retrieving thread by its identifier value.', body: 'Need to verify get by id works.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const getRes = await request(app)
        .get(`/api/v1/qa-threads/${threadId}`)
        .set('Cookie', cookies);

      expect(getRes.status).toBe(200);
      expect(getRes.body.ok).toBe(true);
      expect(getRes.body.data._id).toBe(threadId);
      expect(getRes.body.data.roomId).toBe(roomId);
      expect(getRes.body.data.title).toBe('Retrieving thread by its identifier value.');
      expect(getRes.body.data.body).toBeDefined();
      expect(getRes.body.data.state).toBeDefined();
      expect(getRes.body.data.userId).toBe(userId);
    });

    it('returns 404 for a nonexistent thread id', async () => {
      const { cookies } = await registerAndLogin('qauser10', 'QaPass12345!', 'QA User 10');

      // Valid ObjectId that does not exist in the database
      const nonexistentId = new ObjectId().toString();

      const res = await request(app)
        .get(`/api/v1/qa-threads/${nonexistentId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/qa-threads/:id/posts', () => {
    it('returns posts for a thread in order', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser11', 'QaPass12345!', 'QA User 11');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Thread with multiple posts for testing.', body: 'Starting thread to add replies.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      // Create first post
      const post1Res = await request(app)
        .post(`/api/v1/qa-threads/${threadId}/posts`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ body: 'First reply post with enough content to be valid here.' });
      expect(post1Res.status).toBe(201);

      // Create second post
      const post2Res = await request(app)
        .post(`/api/v1/qa-threads/${threadId}/posts`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ body: 'Second reply post with additional information for the thread.' });
      expect(post2Res.status).toBe(201);

      // Fetch all posts for the thread
      const postsRes = await request(app)
        .get(`/api/v1/qa-threads/${threadId}/posts`)
        .set('Cookie', cookies);

      expect(postsRes.status).toBe(200);
      expect(postsRes.body.ok).toBe(true);
      expect(Array.isArray(postsRes.body.data)).toBe(true);
      expect(postsRes.body.data.length).toBe(2);

      // Verify each post has expected fields
      for (const post of postsRes.body.data) {
        expect(post.threadId).toBe(threadId);
        expect(post.userId).toBeDefined();
        expect(post.body).toBeDefined();
        expect(post._id).toBeDefined();
      }
    });

    it('returns empty list when thread has no posts', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin('qauser12', 'QaPass12345!', 'QA User 12');
      const roomId = await insertRoom();
      await seedEligibleReservation(userId, roomId);

      const threadRes = await request(app)
        .post('/api/v1/qa-threads')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId, title: 'Thread with zero replies created here.', body: 'No replies will be added to this one.' });

      expect(threadRes.status).toBe(201);
      const threadId = threadRes.body.data._id as string;

      const postsRes = await request(app)
        .get(`/api/v1/qa-threads/${threadId}/posts`)
        .set('Cookie', cookies);

      expect(postsRes.status).toBe(200);
      expect(postsRes.body.ok).toBe(true);
      expect(Array.isArray(postsRes.body.data)).toBe(true);
      expect(postsRes.body.data.length).toBe(0);
    });
  });
});
