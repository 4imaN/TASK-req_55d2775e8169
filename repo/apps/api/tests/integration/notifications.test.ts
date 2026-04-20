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

async function seedNotification(userId: string, readAt: Date | null = null): Promise<string> {
  const db = getTestDb();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  const result = await db.collection('notifications').insertOne({
    userId,
    type: 'reservation_reminder',
    title: 'Upcoming Reservation',
    message: 'Your reservation starts soon.',
    referenceType: 'reservation',
    referenceId: new ObjectId().toString(),
    readAt,
    expiresAt,
    createdAt: new Date(),
  });
  return result.insertedId.toString();
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

describe('Notifications API', () => {
  describe('GET /api/v1/notifications', () => {
    it("returns the user's notifications", async () => {
      const { cookies, userId } = await registerAndLogin('notifuser1', 'NotifPass1234!', 'Notif User 1');
      await seedNotification(userId);
      await seedNotification(userId);

      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(2);
    });

    it('does not return notifications of another user', async () => {
      const { userId: otherUserId } = await registerAndLogin('notifother1', 'NotifPass1234!', 'Other User');
      const { cookies } = await registerAndLogin('notifuser2', 'NotifPass1234!', 'Notif User 2');

      await seedNotification(otherUserId);

      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/notifications/unread-count', () => {
    it('returns count of unread notifications', async () => {
      const { cookies, userId } = await registerAndLogin('notifuser3', 'NotifPass1234!', 'Notif User 3');

      await seedNotification(userId, null);          // unread
      await seedNotification(userId, null);          // unread
      await seedNotification(userId, new Date());    // already read

      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(2);
    });

    it('returns 0 when all notifications are read', async () => {
      const { cookies, userId } = await registerAndLogin('notifuser4', 'NotifPass1234!', 'Notif User 4');

      await seedNotification(userId, new Date());
      await seedNotification(userId, new Date());

      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(0);
    });
  });

  describe('PUT /api/v1/notifications/:id/read', () => {
    it('marks a single notification as read', async () => {
      const { cookies, userId, csrfToken } = await registerAndLogin('notifuser5', 'NotifPass1234!', 'Notif User 5');
      const notifId = await seedNotification(userId, null);

      const res = await request(app)
        .put(`/api/v1/notifications/${notifId}/read`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.readAt).not.toBeNull();
    });

    it('returns 404 for a notification belonging to another user', async () => {
      const { userId: otherUserId } = await registerAndLogin('notifother2', 'NotifPass1234!', 'Other Notif 2');
      const { cookies, csrfToken } = await registerAndLogin('notifuser6', 'NotifPass1234!', 'Notif User 6');
      const notifId = await seedNotification(otherUserId, null);

      const res = await request(app)
        .put(`/api/v1/notifications/${notifId}/read`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/notifications/read-all', () => {
    it('marks all unread notifications as read', async () => {
      const { cookies, userId, csrfToken } = await registerAndLogin('notifuser7', 'NotifPass1234!', 'Notif User 7');

      await seedNotification(userId, null);
      await seedNotification(userId, null);
      await seedNotification(userId, null);

      const res = await request(app)
        .put('/api/v1/notifications/read-all')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.data.marked).toBe(true);

      // Verify unread count is now 0
      const countRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', cookies);

      expect(countRes.body.data.count).toBe(0);
    });
  });
});
