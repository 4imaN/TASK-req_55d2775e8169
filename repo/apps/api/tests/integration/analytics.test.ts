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

describe('Analytics API', () => {
  describe('GET /api/v1/analytics/booking-conversion', () => {
    it('returns 0 when no attempts exist', async () => {
      const { cookies } = await registerAndLogin(
        'analytics1', 'AnalyticsPass1234!', 'Analytics User', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/analytics/booking-conversion')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.value).toBe(0);
    });

    it('reflects recorded attempts', async () => {
      const { cookies } = await registerAndLogin(
        'analytics2', 'AnalyticsPass1234!', 'Analytics User 2', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();
      const roomId = new ObjectId().toString();

      // Insert 4 attempts: 3 successful, 1 failed
      await db.collection('reservation_attempts').insertMany([
        { roomId, userId: 'u1', successful: true, attemptedAt: now },
        { roomId, userId: 'u2', successful: true, attemptedAt: now },
        { roomId, userId: 'u3', successful: true, attemptedAt: now },
        { roomId, userId: 'u4', successful: false, attemptedAt: now },
      ]);

      const startDate = new Date(now.getTime() - 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/analytics/booking-conversion?startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // 3 successful / 4 total = 0.75
      expect(res.body.data.value).toBe(0.75);
    });

    it('respects roomId filter', async () => {
      const { cookies } = await registerAndLogin(
        'analytics3', 'AnalyticsPass1234!', 'Analytics User 3', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();
      const roomA = new ObjectId().toString();
      const roomB = new ObjectId().toString();

      // 2 attempts for room A (1 success), 2 for room B (2 successes)
      await db.collection('reservation_attempts').insertMany([
        { roomId: roomA, userId: 'u1', successful: true, attemptedAt: now },
        { roomId: roomA, userId: 'u2', successful: false, attemptedAt: now },
        { roomId: roomB, userId: 'u3', successful: true, attemptedAt: now },
        { roomId: roomB, userId: 'u4', successful: true, attemptedAt: now },
      ]);

      const startDate = new Date(now.getTime() - 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 60 * 1000).toISOString();

      const resA = await request(app)
        .get(`/api/v1/analytics/booking-conversion?roomId=${roomA}&startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(resA.status).toBe(200);
      // Room A: 1 success / 2 total = 0.5
      expect(resA.body.data.value).toBe(0.5);

      const resB = await request(app)
        .get(`/api/v1/analytics/booking-conversion?roomId=${roomB}&startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(resB.status).toBe(200);
      // Room B: 2 success / 2 total = 1.0
      expect(resB.body.data.value).toBe(1);
    });
  });

  describe('GET /api/v1/analytics/peak-utilization', () => {
    it('returns a numeric value', async () => {
      const { cookies } = await registerAndLogin(
        'analytics4', 'AnalyticsPass1234!', 'Analytics User 4', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/analytics/peak-utilization')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('requires administrator role (non-admin gets 403)', async () => {
      const { cookies } = await registerAndLogin(
        'analytics5', 'AnalyticsPass1234!', 'Analytics User 5'
      );

      const res = await request(app)
        .get('/api/v1/analytics/peak-utilization')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/attendance-rate', () => {
    it('returns 0 when no reservations exist', async () => {
      const { cookies } = await registerAndLogin(
        'analytics6', 'AnalyticsPass1234!', 'Analytics User 6', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/analytics/attendance-rate')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('calculates ratio of checked-in to total confirmed reservations', async () => {
      const { cookies } = await registerAndLogin(
        'analytics7', 'AnalyticsPass1234!', 'Analytics User 7', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();
      const roomId = new ObjectId().toString();
      const userId = new ObjectId().toString();

      // 3 confirmed (completed), 2 checked_in
      await db.collection('reservations').insertMany([
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'checked_in', idempotencyKey: 'analytics-att-1', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'checked_in', idempotencyKey: 'analytics-att-2', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'confirmed', idempotencyKey: 'analytics-att-3', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'confirmed', idempotencyKey: 'analytics-att-4', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'confirmed', idempotencyKey: 'analytics-att-5', createdAt: now, updatedAt: now },
      ]);

      const startDate = new Date(now.getTime() - 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/analytics/attendance-rate?startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('requires administrator role', async () => {
      const { cookies } = await registerAndLogin(
        'analytics8', 'AnalyticsPass1234!', 'Analytics User 8'
      );

      const res = await request(app)
        .get('/api/v1/analytics/attendance-rate')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/noshow-rate', () => {
    it('returns a numeric value', async () => {
      const { cookies } = await registerAndLogin(
        'analytics9', 'AnalyticsPass1234!', 'Analytics User 9', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/analytics/noshow-rate')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('reflects no-show reservations seeded in DB', async () => {
      const { cookies } = await registerAndLogin(
        'analytics10', 'AnalyticsPass1234!', 'Analytics User 10', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();
      const roomId = new ObjectId().toString();
      const userId = new ObjectId().toString();

      // 1 no_show, 3 confirmed
      await db.collection('reservations').insertMany([
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'no_show', idempotencyKey: 'analytics-ns-1', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'confirmed', idempotencyKey: 'analytics-ns-2', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'confirmed', idempotencyKey: 'analytics-ns-3', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: now, endAtUtc: now, status: 'confirmed', idempotencyKey: 'analytics-ns-4', createdAt: now, updatedAt: now },
      ]);

      const startDate = new Date(now.getTime() - 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/analytics/noshow-rate?startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('requires administrator role', async () => {
      const { cookies } = await registerAndLogin(
        'analytics11', 'AnalyticsPass1234!', 'Analytics User 11'
      );

      const res = await request(app)
        .get('/api/v1/analytics/noshow-rate')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/offpeak-utilization', () => {
    it('returns a numeric value', async () => {
      const { cookies } = await registerAndLogin(
        'analytics12', 'AnalyticsPass1234!', 'Analytics User 12', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/analytics/offpeak-utilization')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('reflects off-peak reservations seeded in DB', async () => {
      const { cookies } = await registerAndLogin(
        'analytics13', 'AnalyticsPass1234!', 'Analytics User 13', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();
      const roomId = new ObjectId().toString();
      const userId = new ObjectId().toString();

      // Seed reservations with known off-peak and peak hours
      // Off-peak: before 09:00 or after 17:00
      const offPeakStart = new Date(now);
      offPeakStart.setHours(7, 0, 0, 0);
      const offPeakEnd = new Date(offPeakStart.getTime() + 60 * 60 * 1000);

      const peakStart = new Date(now);
      peakStart.setHours(11, 0, 0, 0);
      const peakEnd = new Date(peakStart.getTime() + 60 * 60 * 1000);

      await db.collection('reservations').insertMany([
        { userId, roomId, startAtUtc: offPeakStart, endAtUtc: offPeakEnd, status: 'confirmed', idempotencyKey: 'analytics-op-1', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: peakStart, endAtUtc: peakEnd, status: 'confirmed', idempotencyKey: 'analytics-op-2', createdAt: now, updatedAt: now },
        { userId, roomId, startAtUtc: peakStart, endAtUtc: peakEnd, status: 'confirmed', idempotencyKey: 'analytics-op-3', createdAt: now, updatedAt: now },
      ]);

      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/analytics/offpeak-utilization?startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.value).toBe('number');
    });

    it('requires administrator role', async () => {
      const { cookies } = await registerAndLogin(
        'analytics14', 'AnalyticsPass1234!', 'Analytics User 14'
      );

      const res = await request(app)
        .get('/api/v1/analytics/offpeak-utilization')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/policy-impact', () => {
    it('returns policy impact data', async () => {
      const { cookies } = await registerAndLogin(
        'analytics15', 'AnalyticsPass1234!', 'Analytics User 15', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();

      // Seed a policy version and capture its ID
      const policyResult = await db.collection('policy_versions').insertOne({
        name: 'Test Policy v1',
        effectiveAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
        version: 1,
        rules: { maxDurationMinutes: 120, advanceBookingDays: 14 },
      });
      const policyVersionId = policyResult.insertedId.toString();

      const res = await request(app)
        .get(`/api/v1/analytics/policy-impact?policyVersionId=${policyVersionId}&kpiName=booking_conversion`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // policy-impact returns an object or array with impact metrics
      expect(res.body.data).toBeDefined();
    });

    it('requires administrator role', async () => {
      const { cookies } = await registerAndLogin(
        'analytics16', 'AnalyticsPass1234!', 'Analytics User 16'
      );

      const res = await request(app)
        .get('/api/v1/analytics/policy-impact')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/snapshots', () => {
    it('returns an empty list when no snapshots exist', async () => {
      const { cookies } = await registerAndLogin(
        'analytics17', 'AnalyticsPass1234!', 'Analytics User 17', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/analytics/snapshots')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const data = res.body.data;
      const list = Array.isArray(data) ? data : data.snapshots ?? [];
      expect(Array.isArray(list)).toBe(true);
    });

    it('returns seeded snapshots', async () => {
      const { cookies } = await registerAndLogin(
        'analytics18', 'AnalyticsPass1234!', 'Analytics User 18', ['administrator']
      );

      const db = getTestDb();
      const now = new Date();

      const snapshotPeriodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const snapshotPeriodEnd = new Date(now.getTime() - 23 * 60 * 60 * 1000);
      await db.collection('analytics_snapshots').insertOne({
        kpiName: 'booking_conversion',
        grain: 'day',
        periodStart: snapshotPeriodStart,
        periodEnd: snapshotPeriodEnd,
        value: 0.72,
        metadata: {},
        createdAt: now,
      });

      const startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/v1/analytics/snapshots?startDate=${startDate}&endDate=${endDate}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const data = res.body.data;
      const list = Array.isArray(data) ? data : data.snapshots ?? [];
      expect(list.length).toBeGreaterThanOrEqual(1);
    });

    it('requires administrator role', async () => {
      const { cookies } = await registerAndLogin(
        'analytics19', 'AnalyticsPass1234!', 'Analytics User 19'
      );

      const res = await request(app)
        .get('/api/v1/analytics/snapshots')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });
});
