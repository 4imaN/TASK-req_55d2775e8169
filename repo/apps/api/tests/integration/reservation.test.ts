import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestApp, getTestDb } from '../setup';
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

  // Optionally assign roles in DB
  if (roles && roles.length > 0) {
    const db = getTestDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles } }
    );
  }

  // Re-login to get fresh session with updated roles
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

// Create a zone + room + business hours for tests
async function createTestRoom(): Promise<{ zoneId: string; roomId: string }> {
  const db = getTestDb();

  const zoneRes = await db.collection('zones').insertOne({
    name: 'Test Zone',
    description: 'Test zone for reservations',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const zoneId = zoneRes.insertedId.toString();

  const roomRes = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Test Room A',
    description: 'A room for testing',
    capacity: 4,
    amenities: ['whiteboard'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const roomId = roomRes.insertedId.toString();

  // Add business hours for all 7 days (Monday=1 through Sunday=0 in Luxon)
  for (let day = 0; day <= 6; day++) {
    await db.collection('business_hours').insertOne({
      scope: 'site',
      scopeId: null,
      dayOfWeek: day,
      openTime: '08:00',
      closeTime: '22:00',
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return { zoneId, roomId };
}

// Build a future date aligned to 15-minute increments.
// The start time is anchored at 18:00 UTC on the target day, which corresponds
// to 10:00 AM LA (PST/UTC-8) — well within the seeded business hours of 08:00-22:00.
// Using a fixed UTC hour avoids timezone edge cases where 24h offsets might land
// outside business hours when running in the America/Los_Angeles site timezone.
function futureAligned(offsetHours = 24, durationMinutes = 60): { start: string; end: string } {
  const now = new Date();
  // Advance by roughly offsetHours days (rounded to nearest whole day),
  // then anchor to 18:00 UTC (= 10:00 AM PST) on that calendar date.
  const daysAhead = Math.ceil(offsetHours / 24);
  const base = new Date(now);
  base.setUTCDate(base.getUTCDate() + daysAhead);
  base.setUTCHours(18, 0, 0, 0); // 18:00 UTC = 10:00 AM PST = well within 08:00-22:00 LA
  // Push one more day if still not clearly in the future
  if (base.getTime() <= now.getTime() + 60 * 60 * 1000) {
    base.setUTCDate(base.getUTCDate() + 1);
  }
  const end = new Date(base.getTime() + durationMinutes * 60 * 1000);
  return { start: base.toISOString(), end: end.toISOString() };
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

describe('Reservation API', () => {
  describe('POST /api/v1/reservations - create reservation', () => {
    it('creates a reservation successfully', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'resuser1', 'ResPass1234!', 'Res User'
      );
      const { roomId } = await createTestRoom();
      const { start, end } = futureAligned(24, 60);

      const res = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          startAtUtc: start,
          endAtUtc: end,
          idempotencyKey: 'idem-create-1',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.roomId).toBe(roomId);
      expect(res.body.data.status).toBe('confirmed');
    });

    it('detects conflicts and returns 409 with alternatives', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'resuser2', 'ResPass1234!', 'Res User 2'
      );
      const { cookies: cookies2, csrfToken: csrfToken2 } = await registerAndLogin(
        'resuser3', 'ResPass1234!', 'Res User 3'
      );
      const { roomId } = await createTestRoom();
      const { start, end } = futureAligned(24, 60);

      // First booking succeeds
      const res1 = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          startAtUtc: start,
          endAtUtc: end,
          idempotencyKey: 'idem-conflict-1',
        });
      expect(res1.status).toBe(201);

      // Second booking for same slot should conflict
      const res2 = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies2)
        .set('x-csrf-token', csrfToken2)
        .send({
          roomId,
          startAtUtc: start,
          endAtUtc: end,
          idempotencyKey: 'idem-conflict-2',
        });

      expect(res2.status).toBe(409);
      expect(res2.body.ok).toBe(false);
      expect(res2.body.error.code).toBe('RESERVATION_CONFLICT');
      // Alternatives should be present (may be empty if no slots available nearby)
      expect(res2.body.error.details).toHaveProperty('alternatives');
    });

    it('rejects non-15-minute-aligned times', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'resuser4', 'ResPass1234!', 'Res User 4'
      );
      const { roomId } = await createTestRoom();

      // Misaligned: 10 minutes past the hour
      const now = new Date();
      const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      start.setMinutes(10, 0, 0); // Force to :10 — not aligned
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          startAtUtc: start.toISOString(),
          endAtUtc: end.toISOString(),
          idempotencyKey: 'idem-align-1',
        });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });

    it('rejects reservations outside business hours', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'resuser5', 'ResPass1234!', 'Res User 5'
      );
      const { roomId } = await createTestRoom();

      // 10:00 UTC = 03:00 AM LA (PDT, UTC-7) — always outside 08:00-22:00 LA.
      // Use setUTCHours so the chosen UTC time is machine-timezone-independent.
      const now = new Date();
      const futureDay = new Date(now);
      futureDay.setUTCDate(futureDay.getUTCDate() + 2);
      futureDay.setUTCHours(10, 0, 0, 0); // 10:00 UTC = 03:00 LA PDT (outside LA hours)

      const res = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          startAtUtc: futureDay.toISOString(),
          endAtUtc: new Date(futureDay.getTime() + 60 * 60 * 1000).toISOString(),
          idempotencyKey: 'idem-biz-hours-1',
        });

      // Expect either conflict (outside_business_hours) or 409/422
      expect([409, 422]).toContain(res.status);
    });

    it('returns the same reservation for a duplicate idempotency key', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'resuser6', 'ResPass1234!', 'Res User 6'
      );
      const { roomId } = await createTestRoom();
      const { start, end } = futureAligned(25, 60);

      const payload = {
        roomId,
        startAtUtc: start,
        endAtUtc: end,
        idempotencyKey: 'idem-dedup-key',
      };

      const res1 = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send(payload);
      expect(res1.status).toBe(201);
      const id1 = res1.body.data._id;

      // Re-use same idempotency key — should return same reservation
      const res2 = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send(payload);
      expect(res2.status).toBe(201);
      expect(res2.body.data._id).toBe(id1);
    });

    it('requires all required fields', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'resuser7', 'ResPass1234!', 'Res User 7'
      );

      const res = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ roomId: 'some-id' }); // missing startAtUtc, endAtUtc, idempotencyKey

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /api/v1/reservations/:id/cancel', () => {
    it('allows owner to cancel their reservation', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'canceluser', 'CancelPass1234!', 'Cancel User'
      );
      const { roomId } = await createTestRoom();
      const { start, end } = futureAligned(48, 60);

      const createRes = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          startAtUtc: start,
          endAtUtc: end,
          idempotencyKey: 'idem-cancel-1',
        });
      expect(createRes.status).toBe(201);
      const reservationId = createRes.body.data._id;

      const cancelRes = await request(app)
        .post(`/api/v1/reservations/${reservationId}/cancel`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reason: 'Changed plans' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.ok).toBe(true);
      expect(cancelRes.body.data.status).toBe('canceled');
    });
  });

  describe('POST /api/v1/reservations/:id/check-in', () => {
    it('allows check-in within the valid window', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'checkinuser', 'CheckinPass1234!', 'Checkin User', ['creator']
      );
      const { roomId } = await createTestRoom();

      // Create a reservation that starts 5 minutes from now (within check-in window)
      const nowMs = Date.now();
      // Align to 15 min boundary
      const alignedNow = Math.ceil(nowMs / (15 * 60 * 1000)) * 15 * 60 * 1000;
      const start = new Date(alignedNow);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const db = getTestDb();
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'adminuser', 'AdminPass1234!', 'Admin', ['administrator']
      );

      // Insert reservation directly so we can test check-in without waiting
      const now = new Date();
      // Set start to 5 minutes ago so it's within the check-in window
      const pastStart = new Date(alignedNow - 5 * 60 * 1000);
      const futureEnd = new Date(pastStart.getTime() + 60 * 60 * 1000);

      const insertResult = await db.collection('reservations').insertOne({
        userId: (await db.collection('users').findOne({ username: 'checkinuser' } as any) as any)._id.toString(),
        roomId,
        zoneId: (await db.collection('rooms').findOne({ _id: new ObjectId(roomId) } as any) as any)?.zoneId,
        startAtUtc: pastStart,
        endAtUtc: futureEnd,
        status: 'confirmed',
        idempotencyKey: 'idem-checkin-window',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
      const reservationId = insertResult.insertedId.toString();

      const checkInRes = await request(app)
        .post(`/api/v1/reservations/${reservationId}/check-in`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send();

      expect(checkInRes.status).toBe(200);
      expect(checkInRes.body.ok).toBe(true);
      expect(checkInRes.body.data.status).toBe('checked_in');
    });
  });

  describe('GET /api/v1/reservations/availability', () => {
    it('requires roomId, startDate, endDate query params', async () => {
      const { cookies } = await registerAndLogin(
        'availuser1', 'AvailPass1234!', 'Avail User 1'
      );

      // Missing all params
      const res = await request(app)
        .get('/api/v1/reservations/availability')
        .set('Cookie', cookies);

      expect([400, 422]).toContain(res.status);
      expect(res.body.ok).toBe(false);
    });

    it('returns slot data for valid params', async () => {
      const { cookies } = await registerAndLogin(
        'availuser2', 'AvailPass1234!', 'Avail User 2'
      );
      const { roomId } = await createTestRoom();

      const startDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/reservations/availability?roomId=${roomId}&startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // Response should contain an array of slots or a slots key
      const data = res.body.data;
      expect(data).toBeDefined();
      const slots = Array.isArray(data) ? data : data.slots;
      expect(Array.isArray(slots)).toBe(true);
    });
  });

  describe('GET /api/v1/reservations', () => {
    it('returns own reservations for regular user', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'listuser1', 'ListPass1234!', 'List User 1'
      );
      const { roomId, zoneId } = await createTestRoom();
      const { start, end } = futureAligned(24, 60);

      // Create a reservation for this user
      const createRes = await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId,
          startAtUtc: start,
          endAtUtc: end,
          idempotencyKey: 'idem-list-1',
        });
      expect(createRes.status).toBe(201);

      const listRes = await request(app)
        .get('/api/v1/reservations')
        .set('Cookie', cookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
      // All returned reservations belong to the authenticated user
      for (const r of listRes.body.data) {
        expect(r.userId).toBe(userId);
      }
    });

    it('returns all reservations for staff', async () => {
      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'listuser2', 'ListPass1234!', 'List User 2'
      );
      const { cookies: staffCookies } = await registerAndLogin(
        'liststaff1', 'StaffPass1234!', 'List Staff 1', ['creator']
      );
      const { roomId } = await createTestRoom();
      const { start, end } = futureAligned(48, 60);

      // Create a reservation as the regular user
      await request(app)
        .post('/api/v1/reservations')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({
          roomId,
          startAtUtc: start,
          endAtUtc: end,
          idempotencyKey: 'idem-list-staff-1',
        });

      const listRes = await request(app)
        .get('/api/v1/reservations')
        .set('Cookie', staffCookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      // Staff should see reservations from all users, including the one created above
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
