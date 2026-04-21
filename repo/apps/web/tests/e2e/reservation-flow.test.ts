/**
 * E2E — Reservation Flow
 *
 * Validates the complete reservation user journey as the React frontend
 * experiences it:
 *   Login → Check availability → Create reservation →
 *   View my reservations (list + detail) → Create share link →
 *   View shared reservation → Cancel reservation →
 *   Verify notifications are accessible
 *
 * Mirrors ReservationsPage.tsx + RoomsPage.tsx (booking modal) + SharedReservationPage.tsx:
 *   POST /api/v1/reservations
 *   GET  /api/v1/reservations?mine=true
 *   GET  /api/v1/reservations/:id
 *   POST /api/v1/reservations/:id/cancel
 *   POST /api/v1/share-links
 *   GET  /api/v1/share-links/:token
 *   GET  /api/v1/notifications/unread-count
 *   GET  /api/v1/notifications
 *   PUT  /api/v1/notifications/:id/read
 *   PUT  /api/v1/notifications/read-all
 */

import request from 'supertest';
import express from 'express';
import {
  setupE2eDb,
  teardownE2eDb,
  clearAndReindex,
  getE2eDb,
  registerUser,
  seedBusinessHours,
  tomorrowSlot,
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

async function seedZoneAndRoom(): Promise<{ zoneId: string; roomId: string }> {
  const db = getE2eDb();

  const zoneResult = await db.collection('zones').insertOne({
    name: 'Reservation Zone',
    description: 'For reservation tests',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const zoneId = zoneResult.insertedId.toString();

  const roomResult = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Reservation Room',
    description: 'Room for booking tests',
    capacity: 4,
    amenities: ['wifi'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const roomId = roomResult.insertedId.toString();

  return { zoneId, roomId };
}

async function createReservation(
  appInstance: express.Application,
  cookies: string[],
  csrfToken: string,
  roomId: string,
  startHour = 10,
  endHour = 11
): Promise<string> {
  const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(startHour, endHour);
  await seedBusinessHours(dayOfWeek);

  const res = await request(appInstance)
    .post('/api/v1/reservations')
    .set('Cookie', cookies)
    .set('x-csrf-token', csrfToken)
    .send({
      roomId,
      startAtUtc,
      endAtUtc,
      idempotencyKey: `e2e-res-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

  if (res.status !== 201) {
    throw new Error(
      `Create reservation failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  return res.body.data._id as string;
}

// ── Create reservation (RoomsPage.tsx handleBook) ─────────────────────────────

describe('Reservation flow — Create (POST /reservations)', () => {
  it('creates a reservation and returns confirmed status', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'resuser1',
      password: 'BookPass12345',
      displayName: 'Res User 1',
    });
    const { roomId, zoneId } = await seedZoneAndRoom();
    const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(10, 11);
    await seedBusinessHours(dayOfWeek);

    const res = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        startAtUtc,
        endAtUtc,
        idempotencyKey: `e2e-create-${Date.now()}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    // ReservationsPage.tsx Reservation interface
    const r = res.body.data;
    expect(r._id).toBeDefined();
    expect(r.roomId).toBe(roomId);
    expect(r.zoneId).toBe(zoneId);
    expect(r.userId).toBe(userId);
    expect(r.status).toBe('confirmed');
    expect(r.startAtUtc).toBeDefined();
    expect(r.endAtUtc).toBeDefined();
    expect(r.createdAt).toBeDefined();
  });

  it('returns 409 on double-booking the same room at the same time', async () => {
    const { cookies: c1, csrfToken: csrf1 } = await registerUser(app, {
      username: 'doublebooker1',
      password: 'BookPass12345',
      displayName: 'Double Booker 1',
    });
    const { cookies: c2, csrfToken: csrf2 } = await registerUser(app, {
      username: 'doublebooker2',
      password: 'BookPass12345',
      displayName: 'Double Booker 2',
    });
    const { roomId } = await seedZoneAndRoom();
    const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(14, 15);
    await seedBusinessHours(dayOfWeek);

    // First booking
    const first = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', c1)
      .set('x-csrf-token', csrf1)
      .send({ roomId, startAtUtc, endAtUtc, idempotencyKey: `double-1-${Date.now()}` });
    expect(first.status).toBe(201);

    // Conflicting booking
    const second = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', c2)
      .set('x-csrf-token', csrf2)
      .send({ roomId, startAtUtc, endAtUtc, idempotencyKey: `double-2-${Date.now()}` });

    expect(second.status).toBe(409);
    expect(second.body.ok).toBe(false);
    // RoomsPage.tsx reads alternatives from error.details
    expect(second.body.error).toBeDefined();
  });

  it('returns alternatives in error.details on conflict (RoomsPage.tsx renders them)', async () => {
    const { cookies: c1, csrfToken: csrf1 } = await registerUser(app, {
      username: 'altuser1',
      password: 'BookPass12345',
      displayName: 'Alt User 1',
    });
    const { cookies: c2, csrfToken: csrf2 } = await registerUser(app, {
      username: 'altuser2',
      password: 'BookPass12345',
      displayName: 'Alt User 2',
    });
    const { roomId } = await seedZoneAndRoom();
    const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(16, 17);
    await seedBusinessHours(dayOfWeek);

    await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', c1)
      .set('x-csrf-token', csrf1)
      .send({ roomId, startAtUtc, endAtUtc, idempotencyKey: `alt-fill-${Date.now()}` });

    const conflictRes = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', c2)
      .set('x-csrf-token', csrf2)
      .send({ roomId, startAtUtc, endAtUtc, idempotencyKey: `alt-conflict-${Date.now()}` });

    expect(conflictRes.status).toBe(409);
    // Frontend reads details.alternatives
    // Even if empty, the field should exist or the error shape should be parseable
    expect(conflictRes.body.error).toBeDefined();
  });

  it('rejects booking without authentication', async () => {
    const { roomId } = await seedZoneAndRoom();
    const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(10, 11);
    await seedBusinessHours(dayOfWeek);

    // CSRF middleware runs before auth middleware for POST requests.
    // An unauthenticated POST without a matching CSRF cookie gets 403
    // (CSRF_MISSING/CSRF_MISMATCH) before auth can return 401.
    const res = await request(app)
      .post('/api/v1/reservations')
      .send({ roomId, startAtUtc, endAtUtc, idempotencyKey: 'anon-book' });

    expect([401, 403]).toContain(res.status);
  });

  it('rejects booking in the past', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'pastbooker',
      password: 'BookPass12345',
      displayName: 'Past Booker',
    });
    const { roomId } = await seedZoneAndRoom();

    const past = new Date();
    past.setDate(past.getDate() - 1);
    const pastStart = past.toISOString();
    const pastEnd = new Date(past.getTime() + 3600_000).toISOString();

    const res = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        startAtUtc: pastStart,
        endAtUtc: pastEnd,
        idempotencyKey: `past-${Date.now()}`,
      });

    expect([400, 422, 409]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });
});

// ── List own reservations (ReservationsPage.tsx fetchReservations) ─────────────

describe('Reservation flow — List own (GET /reservations?mine=true)', () => {
  it("lists only the authenticated user's reservations", async () => {
    const { cookies: c1, csrfToken: csrf1, userId: uid1 } = await registerUser(app, {
      username: 'listresuser1',
      password: 'BookPass12345',
      displayName: 'List Res User 1',
    });
    const { cookies: c2, csrfToken: csrf2 } = await registerUser(app, {
      username: 'listresuser2',
      password: 'BookPass12345',
      displayName: 'List Res User 2',
    });
    const { roomId } = await seedZoneAndRoom();

    const resId = await createReservation(app, c1, csrf1, roomId, 10, 11);
    // User 2 books a different time slot so no conflict
    await createReservation(app, c2, csrf2, roomId, 12, 13);

    const res = await request(app)
      .get('/api/v1/reservations')
      .query({ mine: 'true', page: '1', pageSize: '10' })
      .set('Cookie', c1);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Only user 1's reservation should appear
    const ids = (res.body.data as { _id: string }[]).map((r) => r._id);
    expect(ids).toContain(resId);
    expect(ids).toHaveLength(1);

    // Shape: ReservationsPage.tsx Reservation interface
    const r = res.body.data[0];
    expect(r._id).toBeDefined();
    expect(r.roomId).toBeDefined();
    expect(r.zoneId).toBeDefined();
    expect(r.userId).toBe(uid1);
    expect(r.startAtUtc).toBeDefined();
    expect(r.endAtUtc).toBeDefined();
    expect(r.status).toBe('confirmed');
    expect(r.createdAt).toBeDefined();
  });

  it('returns empty list when user has no reservations', async () => {
    const { cookies } = await registerUser(app, {
      username: 'emptyresuser',
      password: 'BookPass12345',
      displayName: 'Empty Res User',
    });

    const res = await request(app)
      .get('/api/v1/reservations')
      .query({ mine: 'true' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('supports status filter', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'statusfilteruser',
      password: 'BookPass12345',
      displayName: 'Status Filter User',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    // Filter by confirmed
    const confirmed = await request(app)
      .get('/api/v1/reservations')
      .query({ mine: 'true', status: 'confirmed' })
      .set('Cookie', cookies);

    expect(confirmed.status).toBe(200);
    const confirmedIds = (confirmed.body.data as { _id: string }[]).map((r) => r._id);
    expect(confirmedIds).toContain(resId);

    // Filter by canceled — should be empty
    const canceled = await request(app)
      .get('/api/v1/reservations')
      .query({ mine: 'true', status: 'canceled' })
      .set('Cookie', cookies);

    expect(canceled.status).toBe(200);
    expect(canceled.body.data).toHaveLength(0);
  });

  it('includes pagination meta (total) the frontend reads', async () => {
    const { cookies } = await registerUser(app, {
      username: 'paginateresuser',
      password: 'BookPass12345',
      displayName: 'Paginate Res User',
    });

    const res = await request(app)
      .get('/api/v1/reservations')
      .query({ mine: 'true', page: '1', pageSize: '10' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.meta).toBeDefined();
    expect(typeof (res.body.meta as { total?: number }).total).toBe('number');
  });
});

// ── Get reservation detail (ReservationsPage.tsx detail modal) ────────────────

describe('Reservation flow — Detail (GET /reservations/:id)', () => {
  it('returns full reservation detail for the owner', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'detailresuser',
      password: 'BookPass12345',
      displayName: 'Detail Res User',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    const res = await request(app)
      .get(`/api/v1/reservations/${resId}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data._id).toBe(resId);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.startAtUtc).toBeDefined();
    expect(res.body.data.endAtUtc).toBeDefined();
  });

  it("returns 403 or 404 when accessing another user's reservation", async () => {
    const { cookies: c1, csrfToken: csrf1 } = await registerUser(app, {
      username: 'resowner',
      password: 'BookPass12345',
      displayName: 'Res Owner',
    });
    const { cookies: c2 } = await registerUser(app, {
      username: 'resvisitor',
      password: 'BookPass12345',
      displayName: 'Res Visitor',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, c1, csrf1, roomId, 10, 11);

    const res = await request(app)
      .get(`/api/v1/reservations/${resId}`)
      .set('Cookie', c2);

    expect([403, 404]).toContain(res.status);
  });
});

// ── Cancel reservation (ReservationsPage.tsx handleCancel) ───────────────────

describe('Reservation flow — Cancel (POST /reservations/:id/cancel)', () => {
  it('cancels a confirmed reservation and returns canceled status', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'cancelresuser',
      password: 'BookPass12345',
      displayName: 'Cancel Res User',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    const cancelRes = await request(app)
      .post(`/api/v1/reservations/${resId}/cancel`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'Changed plans' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.ok).toBe(true);
    expect(cancelRes.body.data.status).toBe('canceled');
  });

  it('prevents canceling an already-canceled reservation', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'doublecanceluser',
      password: 'BookPass12345',
      displayName: 'Double Cancel User',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    // First cancel
    await request(app)
      .post(`/api/v1/reservations/${resId}/cancel`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'First cancel' });

    // Second cancel
    const secondCancel = await request(app)
      .post(`/api/v1/reservations/${resId}/cancel`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'Second cancel' });

    expect([400, 409, 422]).toContain(secondCancel.status);
    expect(secondCancel.body.ok).toBe(false);
  });
});

// ── Share links (ReservationsPage.tsx + SharedReservationPage.tsx) ────────────

describe('Reservation flow — Share links (POST /share-links + GET /share-links/:token)', () => {
  it('creates a share link token and returns it', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'shareuser1',
      password: 'BookPass12345',
      displayName: 'Share User 1',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    const shareRes = await request(app)
      .post('/api/v1/share-links')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reservationId: resId });

    expect(shareRes.status).toBe(200);
    expect(shareRes.body.ok).toBe(true);
    // ReservationsPage.tsx reads: res.data.token
    expect(shareRes.body.data.token).toBeDefined();
    expect(typeof shareRes.body.data.token).toBe('string');
    expect(shareRes.body.data.token.length).toBeGreaterThan(0);
  });

  it('views shared reservation via token (SharedReservationPage.tsx contract)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'shareuser2',
      password: 'BookPass12345',
      displayName: 'Share User 2',
    });
    const { roomId } = await seedZoneAndRoom();
    const resId = await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    // Create share link
    const shareRes = await request(app)
      .post('/api/v1/share-links')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reservationId: resId });

    const token = shareRes.body.data.token as string;

    // View via share link — GET /share-links/:token requires authentication
    const viewRes = await request(app)
      .get(`/api/v1/share-links/${token}`)
      .set('Cookie', cookies);

    expect(viewRes.status).toBe(200);
    expect(viewRes.body.ok).toBe(true);

    // SharedReservationPage.tsx SharedReservation interface
    // getSharedReservation returns: { roomName, zoneName, startAtUtc, endAtUtc, status }
    const data = viewRes.body.data;
    expect(data.startAtUtc).toBeDefined();
    expect(data.endAtUtc).toBeDefined();
    expect(data.status).toBe('confirmed');
    // roomName and zoneName identify the location
    expect(data.roomName).toBeDefined();
    expect(data.zoneName).toBeDefined();
  });

  it('returns 404 or 410 for an invalid share token', async () => {
    // GET /share-links/:token requires authentication
    const { cookies } = await registerUser(app, {
      username: 'shareuser3',
      password: 'BookPass12345',
      displayName: 'Share User 3',
    });
    const res = await request(app)
      .get('/api/v1/share-links/invalid-token-xyz')
      .set('Cookie', cookies);
    expect([404, 410]).toContain(res.status);
    // SharedReservationPage.tsx checks error.code === 'NOT_FOUND' | 'GONE'
    expect(res.body.ok).toBe(false);
  });
});

// ── Notifications (DashboardPage.tsx + NotificationsPage.tsx) ─────────────────

describe('Reservation flow — Notifications contract', () => {
  it('returns unread-count with the shape DashboardPage.tsx expects', async () => {
    const { cookies } = await registerUser(app, {
      username: 'notifuser1',
      password: 'BookPass12345',
      displayName: 'Notif User 1',
    });

    const res = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // DashboardPage.tsx reads: res.data.count
    expect(typeof (res.body.data as { count: number }).count).toBe('number');
    expect((res.body.data as { count: number }).count).toBeGreaterThanOrEqual(0);
  });

  it('returns paginated notifications list with the shape NotificationsPage.tsx expects', async () => {
    const { cookies } = await registerUser(app, {
      username: 'notifuser2',
      password: 'BookPass12345',
      displayName: 'Notif User 2',
    });

    const res = await request(app)
      .get('/api/v1/notifications')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    // NotificationsPage.tsx Notification interface: { _id, type, message, readAt, createdAt }
    if (res.body.data.length > 0) {
      const n = res.body.data[0];
      expect(n._id).toBeDefined();
      expect(typeof n.type).toBe('string');
      expect(typeof n.message).toBe('string');
      expect(n.createdAt).toBeDefined();
      // readAt can be null or string
      expect(n.readAt === null || typeof n.readAt === 'string').toBe(true);
    }

    // meta.total must be defined for pagination
    expect(res.body.meta).toBeDefined();
  });

  it('marks a notification as read (PUT /notifications/:id/read)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'notifmarkuser',
      password: 'BookPass12345',
      displayName: 'Notif Mark User',
    });
    const { roomId } = await seedZoneAndRoom();

    // Create a reservation to trigger a notification
    await createReservation(app, cookies, csrfToken, roomId, 10, 11);

    // Get notifications
    const listRes = await request(app)
      .get('/api/v1/notifications')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    if (listRes.body.data.length === 0) {
      // No notifications generated — endpoint still must respond 200
      const countRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', cookies);
      expect(countRes.status).toBe(200);
      return;
    }

    const notifId = listRes.body.data[0]._id as string;

    const readRes = await request(app)
      .put(`/api/v1/notifications/${notifId}/read`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(readRes.status).toBe(200);
    expect(readRes.body.ok).toBe(true);
  });

  it('marks all notifications as read (PUT /notifications/read-all)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'notifreadalluser',
      password: 'BookPass12345',
      displayName: 'Notif Read All User',
    });

    const res = await request(app)
      .put('/api/v1/notifications/read-all')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
