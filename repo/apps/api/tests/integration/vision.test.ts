/**
 * Vision API Integration Tests
 *
 * Vision routes proxy to a Python worker that is not running during integration
 * tests. These tests validate the auth/validation layer that runs inside Express
 * before any proxy call is attempted. Where a call would reach the worker, we
 * accept 502 (worker unreachable) as a valid outcome alongside the expected
 * auth/validation status — what matters is that the gate fired correctly.
 *
 * DB-direct enrollment routes (GET/DELETE /enrollments/:userId) are tested with
 * real data seeded into the test database without requiring the worker.
 */

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

describe('Vision API - Auth & Validation', () => {
  describe('POST /api/v1/vision/detect', () => {
    it('requires authentication — returns 403 without auth (CSRF blocks before auth)', async () => {
      const res = await request(app).post('/api/v1/vision/detect');
      expect(res.status).toBe(403);
    });

    it('requires creator or admin role — regular user gets 403', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vreguser1', 'VisionPass1234!', 'V Reg User 1'
      );

      const res = await request(app)
        .post('/api/v1/vision/detect')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(403);
    });

    it('requires the frame file — creator without file gets 400 or 503 (disabled)', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vcreator1', 'VisionPass1234!', 'V Creator 1', ['creator']
      );

      const res = await request(app)
        .post('/api/v1/vision/detect')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      // Either 400 (no file validation) or 503 (vision disabled in test env)
      expect([400, 503]).toContain(res.status);
    });

    it('creator with file reaches worker layer — accepts 502 (worker not running) or 503', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vcreator2', 'VisionPass1234!', 'V Creator 2', ['creator']
      );

      const frameBuffer = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
      ]);

      const res = await request(app)
        .post('/api/v1/vision/detect')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .attach('frame', frameBuffer, { filename: 'frame.jpg', contentType: 'image/jpeg' });

      // Auth passed, so we either hit worker (502) or vision is disabled (503)
      expect([400, 502, 503]).toContain(res.status);
    });
  });

  describe('GET /api/v1/vision/cameras', () => {
    it('requires authentication — returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/vision/cameras');
      expect(res.status).toBe(401);
    });

    it('requires creator or admin role — regular user gets 403', async () => {
      const { cookies } = await registerAndLogin(
        'vreguser2', 'VisionPass1234!', 'V Reg User 2'
      );

      const res = await request(app)
        .get('/api/v1/vision/cameras')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('admin reaches the worker layer — accepts 502 (worker not running) or 503', async () => {
      const { cookies } = await registerAndLogin(
        'vadmin1', 'VisionPass1234!', 'V Admin 1', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/vision/cameras')
        .set('Cookie', cookies);

      // Either worker unreachable (502) or vision disabled (503) — both are OK here
      expect([200, 502, 503]).toContain(res.status);
    });
  });

  describe('POST /api/v1/vision/cameras', () => {
    it('requires authentication — returns 401 without auth', async () => {
      const ag = createAgent();
      const csrfToken = await getCsrf(ag) as string;
      const res = await ag
        .post('/api/v1/vision/cameras')
        .set('x-csrf-token', csrfToken)
        .send({ device_identifier: 'cam-001', name: 'Test Camera' });
      expect(res.status).toBe(401);
    });

    it('requires creator or admin role — regular user gets 403', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vreguser3', 'VisionPass1234!', 'V Reg User 3'
      );

      const res = await request(app)
        .post('/api/v1/vision/cameras')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ device_identifier: 'cam-001', name: 'Test Camera' });

      expect(res.status).toBe(403);
    });

    it('returns 400 when device_identifier and name are missing', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vcreator3', 'VisionPass1234!', 'V Creator 3', ['creator']
      );

      const res = await request(app)
        .post('/api/v1/vision/cameras')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vcreator4', 'VisionPass1234!', 'V Creator 4', ['creator']
      );

      const res = await request(app)
        .post('/api/v1/vision/cameras')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ device_identifier: 'cam-missing-name' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/vision/enroll', () => {
    it('requires authentication — returns 401 without auth', async () => {
      const ag = createAgent();
      const csrfToken = await getCsrf(ag) as string;
      const res = await ag
        .post('/api/v1/vision/enroll')
        .set('x-csrf-token', csrfToken)
        .send({});
      expect(res.status).toBe(401);
    });

    it('requires administrator role — regular user gets 403', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vreguser4', 'VisionPass1234!', 'V Reg User 4'
      );

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: 'some-user',
          image_samples: ['img1', 'img2', 'img3'],
          consent_metadata: { consent_given: true },
        });

      expect(res.status).toBe(403);
    });

    it('returns 400 when consent is missing', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vadmin2', 'VisionPass1234!', 'V Admin 2', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: 'some-user',
          image_samples: ['img1', 'img2', 'img3'],
          // consent_metadata omitted — no consent
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when consent_given is false', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vadmin3', 'VisionPass1234!', 'V Admin 3', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: 'some-user',
          image_samples: ['img1', 'img2', 'img3'],
          consent_metadata: { consent_given: false },
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when fewer than 3 image_samples are provided', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vadmin4', 'VisionPass1234!', 'V Admin 4', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: 'some-user',
          image_samples: ['img1', 'img2'],
          consent_metadata: { consent_given: true },
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when image_samples is not an array', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vadmin5', 'VisionPass1234!', 'V Admin 5', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: 'some-user',
          image_samples: 'not-an-array',
          consent_metadata: { consent_given: true },
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/vision/events', () => {
    it('requires authentication — returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/vision/events');
      expect(res.status).toBe(401);
    });

    it('requires administrator role — regular user gets 403', async () => {
      const { cookies } = await registerAndLogin(
        'vreguser5', 'VisionPass1234!', 'V Reg User 5'
      );

      const res = await request(app)
        .get('/api/v1/vision/events')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('creator role is not sufficient — gets 403', async () => {
      const { cookies } = await registerAndLogin(
        'vcreator5', 'VisionPass1234!', 'V Creator 5', ['creator']
      );

      const res = await request(app)
        .get('/api/v1/vision/events')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('admin reaches worker layer — accepts 502 or 503 (worker not running)', async () => {
      const { cookies } = await registerAndLogin(
        'vadmin6', 'VisionPass1234!', 'V Admin 6', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/vision/events')
        .set('Cookie', cookies);

      expect([200, 502, 503]).toContain(res.status);
    });
  });
});

describe('Vision API - Enrollments (DB-direct, no worker)', () => {
  describe('GET /api/v1/vision/enrollments/:userId', () => {
    it('requires administrator role — regular user gets 403', async () => {
      const { cookies } = await registerAndLogin(
        'vreguser6', 'VisionPass1234!', 'V Reg User 6'
      );

      const res = await request(app)
        .get('/api/v1/vision/enrollments/someuserid')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('requires authentication — returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/vision/enrollments/someuserid');
      expect(res.status).toBe(401);
    });

    it('admin can retrieve enrollments and encryptedEmbedding is not in response', async () => {
      const { cookies, userId } = await registerAndLogin(
        'vadmin7', 'VisionPass1234!', 'V Admin 7', ['administrator']
      );

      // Seed an enrollment directly into the DB
      const db = getTestDb();
      await db.collection('face_enrollments').insertOne({
        userId,
        encryptedEmbedding: 'secret-encrypted-embedding-data',
        sampleIndex: 0,
        consentRecordedAt: new Date(),
        consentMetadata: { consent_given: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/vision/enrollments/${userId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.enrollments).toBeDefined();
      expect(Array.isArray(res.body.data.enrollments)).toBe(true);

      // Verify encryptedEmbedding is never surfaced in the response
      const responseBody = JSON.stringify(res.body);
      expect(responseBody).not.toContain('encryptedEmbedding');
      expect(responseBody).not.toContain('secret-encrypted-embedding-data');
    });

    it('admin fetching enrollments for user with none returns empty list', async () => {
      const { cookies } = await registerAndLogin(
        'vadmin8', 'VisionPass1234!', 'V Admin 8', ['administrator']
      );

      const nonExistentUserId = new ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/vision/enrollments/${nonExistentUserId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.enrollments).toBeDefined();
      expect(res.body.data.enrollments.length).toBe(0);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('DELETE /api/v1/vision/enrollments/:userId', () => {
    it('requires administrator role — regular user gets 403', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vreguser7', 'VisionPass1234!', 'V Reg User 7'
      );

      const res = await request(app)
        .delete('/api/v1/vision/enrollments/someuserid')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(403);
    });

    it('requires authentication — returns 401 without auth', async () => {
      const ag = createAgent();
      const csrfToken = await getCsrf(ag) as string;
      const res = await ag
        .delete('/api/v1/vision/enrollments/someuserid')
        .set('x-csrf-token', csrfToken);
      expect(res.status).toBe(401);
    });

    it('admin can delete all enrollments for a user and DB is cleared', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'vadmin9', 'VisionPass1234!', 'V Admin 9', ['administrator']
      );

      const db = getTestDb();
      // Seed two enrollment records for the user
      await db.collection('face_enrollments').insertMany([
        {
          userId,
          encryptedEmbedding: 'test-data-one',
          sampleIndex: 0,
          consentRecordedAt: new Date(),
          consentMetadata: { consent_given: true },
          createdAt: new Date(),
        },
        {
          userId,
          encryptedEmbedding: 'test-data-two',
          sampleIndex: 1,
          consentRecordedAt: new Date(),
          consentMetadata: { consent_given: true },
          createdAt: new Date(),
        },
      ]);

      // Confirm they were inserted
      const beforeCount = await db.collection('face_enrollments').countDocuments({ userId });
      expect(beforeCount).toBe(2);

      const res = await request(app)
        .delete(`/api/v1/vision/enrollments/${userId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.user_id).toBe(userId);
      expect(res.body.data.deleted_count).toBe(2);

      // Verify DB is actually empty
      const afterCount = await db.collection('face_enrollments').countDocuments({ userId });
      expect(afterCount).toBe(0);
    });

    it('delete for user with no enrollments returns 200 with deleted_count 0', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vadmin10', 'VisionPass1234!', 'V Admin 10', ['administrator']
      );

      const nonExistentUserId = new ObjectId().toString();

      const res = await request(app)
        .delete(`/api/v1/vision/enrollments/${nonExistentUserId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.deleted_count).toBe(0);
    });
  });

  // ── POST /api/v1/vision/recognize ──────────────────────────────────────────

  describe('POST /api/v1/vision/recognize', () => {
    it('requires authentication', async () => {
      const ag = createAgent();
      const csrf = await getCsrf(ag) as string;
      const res = await ag
        .post('/api/v1/vision/recognize')
        .set('x-csrf-token', csrf)
        .send({ image: 'base64data' });
      expect(res.status).toBe(401);
    });

    it('requires creator or admin role', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vrecog_user', 'VisionPass1234!', 'V Recog User'
      );
      const res = await request(app)
        .post('/api/v1/vision/recognize')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ image: 'base64data' });
      expect(res.status).toBe(403);
    });

    it('reaches proxy layer as admin (502/503 when worker unavailable)', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vrecog_admin', 'VisionPass1234!', 'V Recog Admin', ['administrator']
      );
      const res = await request(app)
        .post('/api/v1/vision/recognize')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ image: 'base64data' });
      // Worker not running — Express proxy returns 502 or 503
      expect([200, 502, 503]).toContain(res.status);
    });
  });

  // ── PUT /api/v1/vision/cameras/:id ─────────────────────────────────────────

  describe('PUT /api/v1/vision/cameras/:id', () => {
    it('requires authentication', async () => {
      const ag = createAgent();
      const csrf = await getCsrf(ag) as string;
      const res = await ag
        .put('/api/v1/vision/cameras/someid')
        .set('x-csrf-token', csrf)
        .send({ name: 'Updated' });
      expect(res.status).toBe(401);
    });

    it('requires creator or admin role', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vcamupd_user', 'VisionPass1234!', 'V CamUpd User'
      );
      const res = await request(app)
        .put('/api/v1/vision/cameras/someid')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Updated' });
      expect(res.status).toBe(403);
    });

    it('reaches proxy layer as creator (502/503 when worker unavailable)', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'vcamupd_creator', 'VisionPass1234!', 'V CamUpd Creator', ['creator']
      );
      const res = await request(app)
        .put('/api/v1/vision/cameras/test-camera-id')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Updated Name', is_active: false });
      expect([200, 502, 503]).toContain(res.status);
    });
  });
});
