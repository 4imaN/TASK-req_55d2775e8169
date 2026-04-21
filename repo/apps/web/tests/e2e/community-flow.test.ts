/**
 * E2E — Community Flow
 *
 * Validates QA threads, notifications, and export lifecycle as the React
 * frontend experiences them:
 *   Create QA thread → Reply to thread → Pin / collapse thread (moderator) →
 *   List notifications → Mark notification read → Mark all read →
 *   Trigger export (admin) → Check export status
 *
 * Mirrors CommunityPage.tsx / QAPage.tsx / NotificationsPage.tsx /
 *         ExportsPage.tsx contract:
 *   POST /api/v1/qa-threads
 *   GET  /api/v1/qa-threads
 *   GET  /api/v1/qa-threads/:id
 *   POST /api/v1/qa-threads/:id/posts
 *   GET  /api/v1/qa-threads/:id/posts
 *   PUT  /api/v1/qa-threads/:id/pin
 *   PUT  /api/v1/qa-threads/:id/collapse
 *   GET  /api/v1/notifications
 *   GET  /api/v1/notifications/unread-count
 *   PUT  /api/v1/notifications/:id/read
 *   PUT  /api/v1/notifications/read-all
 *   POST /api/v1/exports
 *   GET  /api/v1/exports/:id
 *   GET  /api/v1/exports
 */

import request from 'supertest';
import express from 'express';
import { ObjectId } from 'mongodb';
import {
  setupE2eDb,
  teardownE2eDb,
  clearAndReindex,
  getE2eDb,
  registerUser,
  loginUser,
  promoteToAdmin,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedRoom(): Promise<{ roomId: string; zoneId: string }> {
  const db = getE2eDb();
  const zoneResult = await db.collection('zones').insertOne({
    name: 'Community Zone',
    description: 'For community flow tests',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const zoneId = zoneResult.insertedId.toString();
  const roomResult = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Community Room',
    capacity: 6,
    amenities: ['wifi'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return { roomId: roomResult.insertedId.toString(), zoneId };
}

/**
 * Seeds a completed reservation for `userId` in `roomId` directly into MongoDB.
 * The QA thread `createThread` service requires the author to have a
 * `checked_in` or `completed` reservation for the room before posting.
 */
async function seedCompletedReservation(userId: string, roomId: string): Promise<void> {
  const db = getE2eDb();
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 3600_000);
  const end = new Date(now.getTime() - 3600_000);
  await db.collection('reservations').insertOne({
    userId,
    roomId,
    status: 'completed',
    startAtUtc: start,
    endAtUtc: end,
    idempotencyKey: `seed-completed-${userId}-${roomId}-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

async function setupModeratorSession(): Promise<{
  cookies: string[];
  csrfToken: string;
  userId: string;
}> {
  const db = getE2eDb();
  const { userId } = await registerUser(app, {
    username: 'community_mod',
    password: 'ModeratorPass12345',
    displayName: 'Community Mod',
  });
  await db
    .collection('users')
    .updateOne({ _id: new ObjectId(userId) }, { $set: { roles: ['moderator'] } });
  const { cookies, csrfToken } = await loginUser(app, {
    username: 'community_mod',
    password: 'ModeratorPass12345',
  });
  return { cookies, csrfToken, userId };
}

async function setupAdminSession(): Promise<{
  cookies: string[];
  csrfToken: string;
  adminId: string;
}> {
  const { userId } = await registerUser(app, {
    username: 'community_admin',
    password: 'AdminCommunityPass12345',
    displayName: 'Community Admin',
  });
  await promoteToAdmin(userId);
  const { cookies, csrfToken } = await loginUser(app, {
    username: 'community_admin',
    password: 'AdminCommunityPass12345',
  });
  return { cookies, csrfToken, adminId: userId };
}

// ── Create QA thread for a room ───────────────────────────────────────────────

describe('Community flow — Create QA thread (POST /qa-threads)', () => {
  it('creates a QA thread and returns visible state', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'qa_creator1',
      password: 'QAPass123456',
      displayName: 'QA Creator 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const res = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        title: 'Does this room have a standing desk?',
        body: 'I am looking for a room with an ergonomic standing desk option.',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const thread = res.body.data;
    expect(thread._id).toBeDefined();
    expect(thread.userId).toBe(userId);
    expect(thread.roomId).toBe(roomId);
    expect(thread.title).toBe('Does this room have a standing desk?');
    expect(thread.state).toBe('visible');
    expect(thread.isPinned).toBe(false);
    expect(thread.createdAt).toBeDefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'qa_missing1',
      password: 'QAPass123456',
      displayName: 'QA Missing 1',
    });

    const res = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'Thread without roomId or body' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('requires authentication to create a thread', async () => {
    // CSRF middleware runs before auth middleware for POST requests.
    // An unauthenticated POST without a matching CSRF cookie gets 403
    // (CSRF_MISSING/CSRF_MISMATCH) before auth can return 401.
    const { roomId } = await seedRoom();

    const res = await request(app)
      .post('/api/v1/qa-threads')
      .send({ roomId, title: 'Anonymous thread', body: 'This should fail.' });

    expect([401, 403]).toContain(res.status);
  });

  it('lists threads for a room with pagination', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'qa_lister1',
      password: 'QAPass123456',
      displayName: 'QA Lister 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        title: 'Thread listing test',
        body: 'Can we get a power outlet near the window seats?',
      });

    const listRes = await request(app)
      .get('/api/v1/qa-threads')
      .query({ roomId, page: '1', pageSize: '10' });

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    // Pagination meta
    expect(listRes.body.meta).toBeDefined();
    expect(typeof (listRes.body.meta as { total?: number }).total).toBe('number');
  });

  it('returns 400 when roomId query parameter is missing for list', async () => {
    const res = await request(app).get('/api/v1/qa-threads');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── Reply to QA thread ────────────────────────────────────────────────────────

describe('Community flow — Reply to thread (POST /qa-threads/:id/posts)', () => {
  it('creates a reply post in a thread', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'qa_replier1',
      password: 'QAPass123456',
      displayName: 'QA Replier 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        title: 'Is there a printer nearby?',
        body: 'Need to print documents before a presentation. Any help?',
      });

    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.data._id as string;

    const postRes = await request(app)
      .post(`/api/v1/qa-threads/${threadId}/posts`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ body: 'Yes! There is a printer on the third floor near the elevator.' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.ok).toBe(true);

    const post = postRes.body.data;
    expect(post._id).toBeDefined();
    expect(post.userId).toBe(userId);
    expect(post.threadId).toBe(threadId);
    expect(typeof post.body).toBe('string');
    expect(post.createdAt).toBeDefined();
  });

  it('lists posts in a thread with pagination', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'qa_postlister1',
      password: 'QAPass123456',
      displayName: 'QA Post Lister 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        title: 'Room noise levels during exams?',
        body: 'How quiet is this room during the exam period?',
      });

    const threadId = threadRes.body.data._id as string;

    await request(app)
      .post(`/api/v1/qa-threads/${threadId}/posts`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ body: 'Very quiet during exam period — enforcement is strict.' });

    const listRes = await request(app)
      .get(`/api/v1/qa-threads/${threadId}/posts`)
      .query({ page: '1', pageSize: '10' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    expect(listRes.body.meta).toBeDefined();
  });

  it('returns 400 when post body is missing', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'qa_emptybody1',
      password: 'QAPass123456',
      displayName: 'QA Empty Body 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roomId, title: 'Empty post test', body: 'Testing empty post replies.' });

    const threadId = threadRes.body.data._id as string;

    const postRes = await request(app)
      .post(`/api/v1/qa-threads/${threadId}/posts`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({}); // missing body

    expect(postRes.status).toBe(400);
    expect(postRes.body.ok).toBe(false);
  });
});

// ── Pin thread (moderator) ────────────────────────────────────────────────────

describe('Community flow — Pin thread (PUT /qa-threads/:id/pin)', () => {
  it('moderator can pin a thread', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'qa_pintest1',
      password: 'QAPass123456',
      displayName: 'QA Pin Test 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        roomId,
        title: 'FAQ: Room access during holidays?',
        body: 'Can we access the study rooms during holiday breaks?',
      });

    const threadId = threadRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    const pinRes = await request(app)
      .put(`/api/v1/qa-threads/${threadId}/pin`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ isPinned: true });

    expect(pinRes.status).toBe(200);
    expect(pinRes.body.ok).toBe(true);
    expect(pinRes.body.data.isPinned).toBe(true);
  });

  it('moderator can unpin a pinned thread', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'qa_unpintest1',
      password: 'QAPass123456',
      displayName: 'QA Unpin Test 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        roomId,
        title: 'Pin then unpin test thread',
        body: 'This thread will be pinned then unpinned.',
      });

    const threadId = threadRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    // Pin it first
    await request(app)
      .put(`/api/v1/qa-threads/${threadId}/pin`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ isPinned: true });

    // Then unpin
    const unpinRes = await request(app)
      .put(`/api/v1/qa-threads/${threadId}/pin`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ isPinned: false });

    expect(unpinRes.status).toBe(200);
    expect(unpinRes.body.ok).toBe(true);
    expect(unpinRes.body.data.isPinned).toBe(false);
  });

  it('regular user cannot pin a thread (403)', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'qa_pinreg1',
      password: 'QAPass123456',
      displayName: 'QA Pin Reg 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        roomId,
        title: 'Regular user trying to pin',
        body: 'This user does not have moderator role.',
      });

    const threadId = threadRes.body.data._id as string;

    const pinRes = await request(app)
      .put(`/api/v1/qa-threads/${threadId}/pin`)
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({ isPinned: true });

    expect([403, 401]).toContain(pinRes.status);
  });
});

// ── Collapse thread (moderator) ───────────────────────────────────────────────

describe('Community flow — Collapse thread (PUT /qa-threads/:id/collapse)', () => {
  it('moderator can collapse a thread', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'qa_collapse1',
      password: 'QAPass123456',
      displayName: 'QA Collapse 1',
    });
    const { roomId } = await seedRoom();
    // createThread requires user to have a checked_in/completed reservation for the room
    await seedCompletedReservation(userId, roomId);

    const threadRes = await request(app)
      .post('/api/v1/qa-threads')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        roomId,
        title: 'Off-topic thread to collapse',
        body: 'This thread has drifted off-topic and should be collapsed.',
      });

    const threadId = threadRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    const collapseRes = await request(app)
      .put(`/api/v1/qa-threads/${threadId}/collapse`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf);

    expect(collapseRes.status).toBe(200);
    expect(collapseRes.body.ok).toBe(true);
    expect(collapseRes.body.data.state).toBe('collapsed');
  });
});

// ── Notifications ─────────────────────────────────────────────────────────────

describe('Community flow — Notifications', () => {
  it('returns unread-count with the shape DashboardPage.tsx expects', async () => {
    const { cookies } = await registerUser(app, {
      username: 'comm_notif1',
      password: 'CommPass12345',
      displayName: 'Comm Notif 1',
    });

    const res = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof (res.body.data as { count: number }).count).toBe('number');
    expect((res.body.data as { count: number }).count).toBeGreaterThanOrEqual(0);
  });

  it('returns paginated notifications list', async () => {
    const { cookies } = await registerUser(app, {
      username: 'comm_notif2',
      password: 'CommPass12345',
      displayName: 'Comm Notif 2',
    });

    const res = await request(app)
      .get('/api/v1/notifications')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
  });

  it('marks a notification as read', async () => {
    const db = getE2eDb();
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'comm_notifread1',
      password: 'CommPass12345',
      displayName: 'Comm Notif Read 1',
    });

    // Seed a notification directly
    const notifResult = await db.collection('notifications').insertOne({
      userId,
      type: 'reservation_confirmed',
      title: 'Booking Confirmed',
      message: 'Your study room booking has been confirmed.',
      readAt: null,
      createdAt: new Date(),
    });
    const notifId = notifResult.insertedId.toString();

    const readRes = await request(app)
      .put(`/api/v1/notifications/${notifId}/read`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(readRes.status).toBe(200);
    expect(readRes.body.ok).toBe(true);
    // readAt should now be set
    expect(readRes.body.data.readAt).not.toBeNull();
  });

  it('marks all notifications as read', async () => {
    const db = getE2eDb();
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'comm_notifreadall1',
      password: 'CommPass12345',
      displayName: 'Comm Notif Read All 1',
    });

    // Seed multiple unread notifications
    await db.collection('notifications').insertMany([
      {
        userId,
        type: 'system_update',
        title: 'System Update',
        message: 'New features available.',
        readAt: null,
        createdAt: new Date(),
      },
      {
        userId,
        type: 'reservation_reminder',
        title: 'Reminder',
        message: 'Your booking is in 1 hour.',
        readAt: null,
        createdAt: new Date(),
      },
    ]);

    const readAllRes = await request(app)
      .put('/api/v1/notifications/read-all')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(readAllRes.status).toBe(200);
    expect(readAllRes.body.ok).toBe(true);

    // Verify unread count is now 0
    const countRes = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);

    expect(countRes.status).toBe(200);
    expect((countRes.body.data as { count: number }).count).toBe(0);
  });

  it('returns 404 when marking a notification that belongs to another user', async () => {
    const db = getE2eDb();
    const { userId: uid1 } = await registerUser(app, {
      username: 'comm_notifowner1',
      password: 'CommPass12345',
      displayName: 'Comm Notif Owner 1',
    });
    const { cookies: cookies2, csrfToken: csrf2 } = await registerUser(app, {
      username: 'comm_notifother1',
      password: 'CommPass12345',
      displayName: 'Comm Notif Other 1',
    });

    const notifResult = await db.collection('notifications').insertOne({
      userId: uid1,
      type: 'info',
      title: 'Test',
      message: 'Belongs to user 1',
      readAt: null,
      createdAt: new Date(),
    });
    const notifId = notifResult.insertedId.toString();

    const res = await request(app)
      .put(`/api/v1/notifications/${notifId}/read`)
      .set('Cookie', cookies2)
      .set('x-csrf-token', csrf2);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

// ── Exports (admin) ───────────────────────────────────────────────────────────

describe('Community flow — Exports (POST /exports + GET /exports/:id)', () => {
  it('admin triggers an export job and gets 202 response', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/exports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ exportType: 'reservations', filters: {} });

    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);

    // ExportsPage.tsx ExportJob interface
    const job = res.body.data;
    expect(job._id).toBeDefined();
    expect(job.exportType).toBe('reservations');
    expect(job.status).toBeDefined();
    expect(job.createdAt).toBeDefined();
  });

  it('checks export job status (GET /exports/:id)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    // Create the export job — valid types: reservations, attendance, leads, ledger, analytics, policy_impact
    const createRes = await request(app)
      .post('/api/v1/exports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ exportType: 'ledger', filters: {} });

    expect(createRes.status).toBe(202);
    const jobId = createRes.body.data._id as string;

    // Check status
    const statusRes = await request(app)
      .get(`/api/v1/exports/${jobId}`)
      .set('Cookie', cookies);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.ok).toBe(true);

    const job = statusRes.body.data;
    expect(job._id).toBe(jobId);
    expect(typeof job.status).toBe('string');
    // Valid statuses per EXPORT_JOB_TRANSITIONS: queued, running, completed, failed, expired
    expect(['queued', 'running', 'completed', 'failed', 'expired']).toContain(job.status);
    expect(job.exportType).toBe('ledger');
  });

  it('lists export jobs (GET /exports)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    // Trigger an export — valid types: reservations, attendance, leads, ledger, analytics, policy_impact
    await request(app)
      .post('/api/v1/exports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ exportType: 'analytics', filters: {} });

    const listRes = await request(app)
      .get('/api/v1/exports')
      .query({ page: '1', pageSize: '10' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    expect(listRes.body.meta).toBeDefined();
    expect(typeof (listRes.body.meta as { total?: number }).total).toBe('number');
  });

  it('returns 400 when exportType is missing', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/exports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ filters: {} }); // missing exportType

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('regular user cannot trigger exports (403)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'export_norole1',
      password: 'ExportPass12345',
      displayName: 'Export No Role 1',
    });

    const res = await request(app)
      .post('/api/v1/exports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ exportType: 'reservations', filters: {} });

    expect([403, 401]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 for non-existent export job id', async () => {
    const { cookies } = await setupAdminSession();

    const fakeId = new ObjectId().toString();
    const res = await request(app)
      .get(`/api/v1/exports/${fakeId}`)
      .set('Cookie', cookies);

    expect([400, 404]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });
});
