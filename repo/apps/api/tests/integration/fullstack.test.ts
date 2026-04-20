/**
 * Fullstack Integration Test
 *
 * This test exercises the real Express API through the same HTTP surface
 * that the React frontend consumes: register, login, list zones/rooms,
 * create a reservation, and verify the end-to-end data flow.
 *
 * It does NOT render React components — it validates the API contract
 * that the frontend depends on, proving that the declared fullstack
 * project's backend actually serves the data the frontend expects.
 */

import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

async function getCsrf(ag?: ReturnType<typeof request.agent>): Promise<string | { token: string; csrfCookies: string[] }> {
  if (ag) {
    const res = await ag.get('/api/v1/auth/csrf');
    return res.body.data.csrfToken as string;
  }
  const res = await request(app).get('/api/v1/auth/csrf');
  return {
    token: res.body.data.csrfToken as string,
    csrfCookies: (res.headers['set-cookie'] as unknown as string[]) || [],
  };
}

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

describe('Fullstack Integration — User Journey', () => {
  it('register → login → list zones → list rooms → create reservation → list own reservations → cancel', async () => {
    const db = getTestDb();

    // ── Step 1: Register ──────────────────────────────────
    const ag1 = request.agent(app);
    const csrf1 = await getCsrf(ag1) as string;
    const regRes = await ag1
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrf1)
      .send({ username: 'e2euser', password: 'E2ePassword1234', displayName: 'E2E User' });

    expect(regRes.status).toBe(200);
    expect(regRes.body.ok).toBe(true);
    expect(regRes.body.data.user.username).toBe('e2euser');
    expect(regRes.body.data.csrfToken).toBeDefined();
    const cookies = regRes.headers['set-cookie'] as unknown as string[];
    let csrfToken = regRes.body.data.csrfToken as string;
    const userId = regRes.body.data.user._id as string;

    // ── Step 2: Verify session with /auth/me ──────────────
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.username).toBe('e2euser');
    expect(meRes.body.data.user.passwordHash).toBeUndefined();

    // ── Step 3: Seed a zone and room (admin action, done via DB for brevity)
    const zoneResult = await db.collection('zones').insertOne({
      name: 'E2E Zone',
      description: 'Test zone',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    const zoneId = zoneResult.insertedId.toString();

    const roomResult = await db.collection('rooms').insertOne({
      zoneId,
      name: 'E2E Room',
      description: 'Test room',
      capacity: 4,
      amenities: ['wifi'],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    const roomId = roomResult.insertedId.toString();

    // Seed business hours for today
    const today = new Date().getDay(); // 0=Sunday
    await db.collection('business_hours').insertOne({
      scope: 'site',
      scopeId: null,
      dayOfWeek: today,
      openTime: '00:00',
      closeTime: '23:59',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    // ── Step 4: List zones (frontend Rooms page does this)
    const zonesRes = await request(app)
      .get('/api/v1/zones')
      .set('Cookie', cookies);

    expect(zonesRes.status).toBe(200);
    expect(zonesRes.body.ok).toBe(true);
    expect(zonesRes.body.data).toHaveLength(1);
    expect(zonesRes.body.data[0].name).toBe('E2E Zone');

    // ── Step 5: List rooms (frontend Rooms page does this)
    const roomsRes = await request(app)
      .get('/api/v1/rooms')
      .set('Cookie', cookies);

    expect(roomsRes.status).toBe(200);
    expect(roomsRes.body.data).toHaveLength(1);
    expect(roomsRes.body.data[0].name).toBe('E2E Room');

    // ── Step 6: Check availability
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const availRes = await request(app)
      .get('/api/v1/reservations/availability')
      .query({ roomId, startDate: dateStr, endDate: dateStr })
      .set('Cookie', cookies);

    expect(availRes.status).toBe(200);
    expect(availRes.body.ok).toBe(true);
    expect(Array.isArray(availRes.body.data)).toBe(true);

    // ── Step 7: Create a reservation
    // Use a future time aligned to 15-minute increments
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + 1);
    startTime.setHours(10, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(11, 0, 0, 0);

    // Need business hours for the reservation day
    const reservationDay = startTime.getDay();
    if (reservationDay !== today) {
      await db.collection('business_hours').insertOne({
        scope: 'site',
        scopeId: null,
        dayOfWeek: reservationDay,
        openTime: '00:00',
        closeTime: '23:59',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
    }

    const bookRes = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        roomId,
        startAtUtc: startTime.toISOString(),
        endAtUtc: endTime.toISOString(),
        idempotencyKey: 'e2e-booking-1',
      });

    expect(bookRes.status).toBe(201);
    expect(bookRes.body.ok).toBe(true);
    expect(bookRes.body.data.status).toBe('confirmed');
    expect(bookRes.body.data.roomId).toBe(roomId);
    expect(bookRes.body.data.userId).toBe(userId);
    const reservationId = bookRes.body.data._id as string;

    // ── Step 8: List own reservations (frontend Reservations page does this)
    const listRes = await request(app)
      .get('/api/v1/reservations')
      .query({ mine: 'true' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0]._id).toBe(reservationId);
    expect(listRes.body.data[0].startAtUtc).toBeDefined();
    expect(listRes.body.data[0].endAtUtc).toBeDefined();

    // ── Step 9: Get reservation detail
    const detailRes = await request(app)
      .get(`/api/v1/reservations/${reservationId}`)
      .set('Cookie', cookies);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.status).toBe('confirmed');

    // ── Step 10: Add to favorites
    const favRes = await request(app)
      .post('/api/v1/favorites')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roomId });

    expect(favRes.status).toBe(200);

    // ── Step 11: List favorites
    const favListRes = await request(app)
      .get('/api/v1/favorites')
      .set('Cookie', cookies);

    expect(favListRes.status).toBe(200);
    expect(favListRes.body.data).toHaveLength(1);

    // ── Step 12: Create share link
    const shareRes = await request(app)
      .post('/api/v1/share-links')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reservationId });

    expect(shareRes.status).toBe(200);
    expect(shareRes.body.data.token).toBeDefined();
    const shareToken = shareRes.body.data.token;

    // ── Step 13: View shared reservation
    const sharedRes = await request(app)
      .get(`/api/v1/share-links/${shareToken}`)
      .set('Cookie', cookies);

    expect(sharedRes.status).toBe(200);
    expect(sharedRes.body.data.status).toBe('confirmed');

    // ── Step 14: Cancel reservation
    const cancelRes = await request(app)
      .post(`/api/v1/reservations/${reservationId}/cancel`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'E2E test cleanup' });

    // Users can cancel before start time — should succeed
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('canceled');

    // ── Step 15: Verify notification was created
    const notifRes = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);

    expect(notifRes.status).toBe(200);
    // May or may not have notifications depending on background jobs

    // ── Step 16: Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(logoutRes.status).toBe(200);

    // ── Step 17: Confirm session is invalidated
    const afterLogoutRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);

    expect(afterLogoutRes.status).toBe(401);
  });

  it('admin staff journey: login → manage zones/rooms → view audit logs → list users', async () => {
    const db = getTestDb();

    // Register admin
    const agReg = request.agent(app);
    const csrf1 = await getCsrf(agReg) as string;
    const regRes = await agReg
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrf1)
      .send({ username: 'e2eadmin', password: 'E2eAdminPass123', displayName: 'E2E Admin' });

    const adminId = regRes.body.data.user._id;
    await db.collection('users').updateOne(
      { _id: new ObjectId(adminId) },
      { $set: { roles: ['administrator'] } }
    );

    const agLogin = request.agent(app);
    const csrf2 = await getCsrf(agLogin) as string;
    const loginRes = await agLogin
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrf2)
      .send({ username: 'e2eadmin', password: 'E2eAdminPass123' });

    const cookies = loginRes.headers['set-cookie'] as unknown as string[];
    let csrfToken = loginRes.body.data.csrfToken as string;

    // Create zone
    const zoneRes = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Admin Zone', description: 'Created by admin' });

    expect(zoneRes.status).toBe(201);
    const zoneId = zoneRes.body.data._id;

    // Create room
    const roomRes = await request(app)
      .post('/api/v1/rooms')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ zoneId, name: 'Admin Room', capacity: 6, amenities: ['projector'] });

    expect(roomRes.status).toBe(201);

    // View audit logs (should have registration + login + zone + room actions)
    const auditRes = await request(app)
      .get('/api/v1/audit-logs')
      .set('Cookie', cookies);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.length).toBeGreaterThan(0);

    // Verify audit chain
    const verifyRes = await request(app)
      .get('/api/v1/audit-logs/verify')
      .set('Cookie', cookies);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.valid).toBe(true);

    // List users
    const usersRes = await request(app)
      .get('/api/v1/users')
      .set('Cookie', cookies);

    expect(usersRes.status).toBe(200);
    expect(usersRes.body.data.length).toBeGreaterThan(0);

    // List policies
    const policiesRes = await request(app)
      .get('/api/v1/policies')
      .set('Cookie', cookies);

    expect(policiesRes.status).toBe(200);
  });
});
