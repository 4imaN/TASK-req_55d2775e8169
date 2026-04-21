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
 *
 * "Worker-mocked" tests enable the vision subsystem and intercept the global
 * fetch() used by proxyToVisionWorker / the detect handler to return realistic
 * payloads without a real worker process. This validates happy-path response
 * shapes, embedding stripping, and audit-log side-effects.
 */

import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';
import { config } from '../../src/config';

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

// ── Worker-mocked success tests ───────────────────────────────────────────────
//
// These tests enable the vision subsystem by mutating the config at runtime
// (TypeScript `as const` does not emit Object.freeze, so properties are still
// writable) and mock global fetch() — which is what proxyToVisionWorker and
// the detect handler both use — to return realistic success payloads.
//
// Each test restores the spy and config after execution to avoid cross-test
// contamination.

describe('Vision API - Worker-mocked happy paths', () => {
  // ---- module-level state for the mocked-worker suite ----------------------

  const MOCK_WORKER_URL = 'http://vision-worker-mock:5000';

  // Save original config values so we can restore after this suite
  let originalEnabled: boolean;
  let originalWorkerUrl: string;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Enable vision worker for this suite and point at the mock URL
    originalEnabled = (config as any).vision.enabled;
    originalWorkerUrl = (config as any).vision.workerUrl;
    (config as any).vision.enabled = true;
    (config as any).vision.workerUrl = MOCK_WORKER_URL;
  });

  afterAll(async () => {
    // Restore config so later tests (if any) are not affected
    (config as any).vision.enabled = originalEnabled;
    (config as any).vision.workerUrl = originalWorkerUrl;
  });

  beforeEach(async () => {
    // Clear collections
    const db = getTestDb();
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
    const { bootstrapIndexes } = await import('../../src/config/db');
    await bootstrapIndexes();

    // Install a fresh fetch spy before each test
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    // Always restore fetch so other test suites are unaffected
    if (fetchSpy) fetchSpy.mockRestore();
  });

  // ── Helper: build a minimal mock Response ──────────────────────────────────

  function mockFetchResponse(status: number, body: unknown): Response {
    const bodyStr = JSON.stringify(body);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(bodyStr),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response;
  }

  // ── POST /api/v1/vision/detect ──────────────────────────────────────────────

  describe('POST /api/v1/vision/detect — worker returns faces', () => {
    it('returns 200 with face detection results and forwards worker payload verbatim', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_detect1', 'VisionPass1234!', 'WM Detect 1', ['creator']
      );

      const workerPayload = {
        ok: true,
        faces: [
          {
            bbox: { x: 100, y: 50, width: 80, height: 100 },
            confidence: 0.97,
            landmarks: { left_eye: [140, 90], right_eye: [160, 90] },
            track_id: 'track-abc-001',
          },
        ],
        frame_id: 'frame-xyz-001',
        processed_at: '2026-04-21T12:00:00Z',
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const frameBuffer = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
      ]);

      const res = await request(app)
        .post('/api/v1/vision/detect')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .attach('frame', frameBuffer, { filename: 'frame.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.faces)).toBe(true);
      expect(res.body.faces).toHaveLength(1);
      expect(res.body.faces[0].confidence).toBe(0.97);
      expect(res.body.faces[0].track_id).toBe('track-abc-001');
      expect(res.body.frame_id).toBe('frame-xyz-001');
    });

    it('forwards the fetch call to the correct worker URL with FormData', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_detect2', 'VisionPass1234!', 'WM Detect 2', ['administrator']
      );

      const workerPayload = { ok: true, faces: [], frame_id: 'empty-frame' };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const frameBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);

      await request(app)
        .post('/api/v1/vision/detect')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .attach('frame', frameBuffer, { filename: 'test.jpg', contentType: 'image/jpeg' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe(`${MOCK_WORKER_URL}/api/v1/vision/detect`);
      expect(calledOptions.method).toBe('POST');
      // The body should be a FormData instance (multipart upload)
      expect(calledOptions.body).toBeInstanceOf(FormData);
    });

    it('returns worker error status when worker reports a processing failure', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_detect3', 'VisionPass1234!', 'WM Detect 3', ['creator']
      );

      const workerPayload = { ok: false, error: 'IMAGE_TOO_SMALL', message: 'Frame dimensions are too small' };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(422, workerPayload));

      const frameBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);

      const res = await request(app)
        .post('/api/v1/vision/detect')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .attach('frame', frameBuffer, { filename: 'tiny.jpg', contentType: 'image/jpeg' });

      // API proxies the worker status code verbatim for detect
      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe('IMAGE_TOO_SMALL');
    });
  });

  // ── POST /api/v1/vision/recognize ──────────────────────────────────────────

  describe('POST /api/v1/vision/recognize — worker returns a match', () => {
    it('returns 200 with recognition decision and matched_user_id', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_recog1', 'VisionPass1234!', 'WM Recog 1', ['creator']
      );

      const workerPayload = {
        ok: true,
        decision: 'MATCH',
        matched_user_id: 'user-abc-123',
        confidence: 0.94,
        threshold: 0.82,
        // embedding should be stripped by the API layer before returning
        embedding: [0.1, 0.2, 0.3],
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .post('/api/v1/vision/recognize')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ image: 'base64encodedimagedata==' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.decision).toBe('MATCH');
      expect(res.body.matched_user_id).toBe('user-abc-123');
      expect(res.body.confidence).toBe(0.94);
    });

    it('strips embedding and embeddings fields from worker response', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_recog2', 'VisionPass1234!', 'WM Recog 2', ['administrator']
      );

      const workerPayload = {
        ok: true,
        decision: 'NO_MATCH',
        confidence: 0.45,
        embedding: [0.1, 0.2, 0.3, 0.4],
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .post('/api/v1/vision/recognize')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ image: 'base64data==' });

      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('NO_MATCH');
      // Privacy invariant: embedding vectors must never be surfaced
      expect(res.body).not.toHaveProperty('embedding');
      expect(res.body).not.toHaveProperty('embeddings');
    });

    it('forwards the request body to the worker and passes internal API key header when set', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_recog3', 'VisionPass1234!', 'WM Recog 3', ['administrator']
      );

      const workerPayload = { ok: true, decision: 'UNKNOWN', confidence: 0.2 };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      // Set internal key env var so the route can include it
      const originalKey = process.env.VISION_INTERNAL_KEY;
      process.env.VISION_INTERNAL_KEY = 'test-internal-key-abc';

      try {
        await request(app)
          .post('/api/v1/vision/recognize')
          .set('Cookie', cookies)
          .set('x-csrf-token', csrfToken)
          .send({ image: 'imagedata==', camera_id: 'cam-007' });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
        expect(calledUrl).toBe(`${MOCK_WORKER_URL}/api/v1/vision/recognize`);
        expect(calledOptions.method).toBe('POST');
        expect(calledOptions.headers['X-Internal-Api-Key']).toBe('test-internal-key-abc');
        const sentBody = JSON.parse(calledOptions.body as string);
        expect(sentBody.image).toBe('imagedata==');
        expect(sentBody.camera_id).toBe('cam-007');
      } finally {
        if (originalKey === undefined) {
          delete process.env.VISION_INTERNAL_KEY;
        } else {
          process.env.VISION_INTERNAL_KEY = originalKey;
        }
      }
    });
  });

  // ── GET /api/v1/vision/cameras ─────────────────────────────────────────────

  describe('GET /api/v1/vision/cameras — worker returns camera list', () => {
    it('returns 200 with an array of camera objects', async () => {
      const { cookies } = await registerAndLogin(
        'wm_cam_list1', 'VisionPass1234!', 'WM CamList 1', ['creator']
      );

      const workerPayload = {
        ok: true,
        cameras: [
          { id: 'cam-001', device_identifier: 'DEV-001', name: 'Library Entrance', is_active: true },
          { id: 'cam-002', device_identifier: 'DEV-002', name: 'Study Room B', is_active: false },
        ],
        total: 2,
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .get('/api/v1/vision/cameras')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.cameras)).toBe(true);
      expect(res.body.cameras).toHaveLength(2);
      expect(res.body.cameras[0].name).toBe('Library Entrance');
      expect(res.body.cameras[1].is_active).toBe(false);
      expect(res.body.total).toBe(2);
    });

    it('returns 200 with empty list when no cameras are registered', async () => {
      const { cookies } = await registerAndLogin(
        'wm_cam_list2', 'VisionPass1234!', 'WM CamList 2', ['administrator']
      );

      const workerPayload = { ok: true, cameras: [], total: 0 };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .get('/api/v1/vision/cameras')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.cameras).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });

  // ── POST /api/v1/vision/cameras ────────────────────────────────────────────

  describe('POST /api/v1/vision/cameras — worker accepts registration', () => {
    it('returns 201 with created camera and writes an audit log entry', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'wm_cam_reg1', 'VisionPass1234!', 'WM CamReg 1', ['creator']
      );

      const workerPayload = {
        ok: true,
        camera: {
          id: 'cam-new-001',
          device_identifier: 'CAM-MAIN-ENTRANCE',
          name: 'Main Entrance',
          location: 'Building A',
          is_active: true,
          created_at: '2026-04-21T12:00:00Z',
        },
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(201, workerPayload));

      const res = await request(app)
        .post('/api/v1/vision/cameras')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          device_identifier: 'CAM-MAIN-ENTRANCE',
          name: 'Main Entrance',
          location: 'Building A',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.camera.id).toBe('cam-new-001');
      expect(res.body.camera.device_identifier).toBe('CAM-MAIN-ENTRANCE');
      expect(res.body.camera.name).toBe('Main Entrance');

      // Verify the audit log entry was written
      const db = getTestDb();
      const auditEntry = await db.collection('audit_logs').findOne({
        action: 'camera.register',
        objectId: 'CAM-MAIN-ENTRANCE',
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.actorUserId).toBe(userId);
      expect(auditEntry!.objectType).toBe('camera_device');
      expect(auditEntry!.newValue?.name).toBe('Main Entrance');
      expect(auditEntry!.newValue?.location).toBe('Building A');
    });

    it('sends all provided fields to the worker', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_cam_reg2', 'VisionPass1234!', 'WM CamReg 2', ['administrator']
      );

      const workerPayload = { ok: true, camera: { id: 'cam-999', device_identifier: 'CAM-Z', name: 'Zone Z' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(201, workerPayload));

      await request(app)
        .post('/api/v1/vision/cameras')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          device_identifier: 'CAM-Z',
          name: 'Zone Z',
          location: 'Basement',
          zone_id: 'zone-b1',
          room_id: 'room-101',
          is_active: false,
        });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, calledOptions] = fetchSpy.mock.calls[0];
      const sentBody = JSON.parse(calledOptions.body as string);
      expect(sentBody.device_identifier).toBe('CAM-Z');
      expect(sentBody.name).toBe('Zone Z');
      expect(sentBody.location).toBe('Basement');
      expect(sentBody.zone_id).toBe('zone-b1');
      expect(sentBody.room_id).toBe('room-101');
      expect(sentBody.is_active).toBe(false);
    });
  });

  // ── PUT /api/v1/vision/cameras/:id ─────────────────────────────────────────

  describe('PUT /api/v1/vision/cameras/:id — worker accepts update', () => {
    it('returns 200 with updated camera and writes an audit log entry', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'wm_cam_upd1', 'VisionPass1234!', 'WM CamUpd 1', ['creator']
      );

      const cameraId = 'cam-existing-001';
      const workerPayload = {
        ok: true,
        camera: {
          id: cameraId,
          device_identifier: 'DEV-001',
          name: 'Updated Name',
          is_active: false,
          updated_at: '2026-04-21T13:00:00Z',
        },
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .put(`/api/v1/vision/cameras/${cameraId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Updated Name', is_active: false });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.camera.name).toBe('Updated Name');
      expect(res.body.camera.is_active).toBe(false);

      // Verify the audit log entry was written
      const db = getTestDb();
      const auditEntry = await db.collection('audit_logs').findOne({
        action: 'camera.update',
        objectId: cameraId,
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.actorUserId).toBe(userId);
      expect(auditEntry!.objectType).toBe('camera_device');
      expect(auditEntry!.newValue?.name).toBe('Updated Name');
      expect(auditEntry!.newValue?.is_active).toBe(false);
    });

    it('sends all update fields to the correct worker URL', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_cam_upd2', 'VisionPass1234!', 'WM CamUpd 2', ['administrator']
      );

      const cameraId = 'cam-target-007';
      const workerPayload = { ok: true, camera: { id: cameraId, name: 'Relocated Camera' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      await request(app)
        .put(`/api/v1/vision/cameras/${cameraId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Relocated Camera', location: 'Floor 3', zone_id: 'zone-3a' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe(`${MOCK_WORKER_URL}/api/v1/vision/cameras/${cameraId}`);
      expect(calledOptions.method).toBe('PUT');
      const sentBody = JSON.parse(calledOptions.body as string);
      expect(sentBody.name).toBe('Relocated Camera');
      expect(sentBody.location).toBe('Floor 3');
      expect(sentBody.zone_id).toBe('zone-3a');
    });
  });

  // ── GET /api/v1/vision/events ──────────────────────────────────────────────

  describe('GET /api/v1/vision/events — worker returns event list', () => {
    it('returns 200 with face recognition events list', async () => {
      const { cookies } = await registerAndLogin(
        'wm_events1', 'VisionPass1234!', 'WM Events 1', ['administrator']
      );

      const workerPayload = {
        ok: true,
        events: [
          {
            id: 'evt-001',
            camera_id: 'cam-001',
            decision: 'MATCH',
            matched_user_id: 'user-abc',
            confidence: 0.95,
            timestamp: '2026-04-21T10:00:00Z',
          },
          {
            id: 'evt-002',
            camera_id: 'cam-002',
            decision: 'NO_MATCH',
            matched_user_id: null,
            confidence: 0.41,
            timestamp: '2026-04-21T10:05:00Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .get('/api/v1/vision/events')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.events[0].decision).toBe('MATCH');
      expect(res.body.events[1].decision).toBe('NO_MATCH');
      expect(res.body.total).toBe(2);
    });

    it('forwards allowed query parameters to the worker', async () => {
      const { cookies } = await registerAndLogin(
        'wm_events2', 'VisionPass1234!', 'WM Events 2', ['administrator']
      );

      const workerPayload = { ok: true, events: [], total: 0, page: 2, pageSize: 5 };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      await request(app)
        .get('/api/v1/vision/events')
        .query({ page: '2', pageSize: '5', camera_id: 'cam-003', decision: 'MATCH' })
        .set('Cookie', cookies);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchSpy.mock.calls[0];
      const url = new URL(calledUrl as string);
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('pageSize')).toBe('5');
      expect(url.searchParams.get('camera_id')).toBe('cam-003');
      expect(url.searchParams.get('decision')).toBe('MATCH');
    });

    it('does not forward unrecognised query parameters to the worker', async () => {
      const { cookies } = await registerAndLogin(
        'wm_events3', 'VisionPass1234!', 'WM Events 3', ['administrator']
      );

      const workerPayload = { ok: true, events: [], total: 0 };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      await request(app)
        .get('/api/v1/vision/events')
        .query({ page: '1', injected_field: 'dangerous', __proto__: 'attack' })
        .set('Cookie', cookies);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchSpy.mock.calls[0];
      const url = new URL(calledUrl as string);
      expect(url.searchParams.has('injected_field')).toBe(false);
      expect(url.searchParams.has('__proto__')).toBe(false);
      expect(url.searchParams.get('page')).toBe('1');
    });
  });

  // ── POST /api/v1/vision/enroll ─────────────────────────────────────────────

  describe('POST /api/v1/vision/enroll — worker accepts enrollment', () => {
    it('returns 200 with enrollment confirmation and writes an audit log entry', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'wm_enroll1', 'VisionPass1234!', 'WM Enroll 1', ['administrator']
      );

      // Create the target user to enroll
      const db = getTestDb();
      const targetUser = await registerAndLogin(
        'wm_enroll_target1', 'VisionPass1234!', 'WM Enroll Target 1'
      );

      const workerPayload = {
        ok: true,
        enrollment: {
          user_id: targetUser.userId,
          sample_count: 3,
          status: 'enrolled',
          enrolled_at: '2026-04-21T12:00:00Z',
        },
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: targetUser.userId,
          image_samples: ['base64img1==', 'base64img2==', 'base64img3=='],
          consent_metadata: {
            consent_given: true,
            consent_timestamp: '2026-04-21T11:59:00Z',
            consent_actor: userId,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.enrollment.user_id).toBe(targetUser.userId);
      expect(res.body.enrollment.status).toBe('enrolled');
      expect(res.body.enrollment.sample_count).toBe(3);

      // Audit log must record the enrollment event
      const auditEntry = await db.collection('audit_logs').findOne({
        action: 'vision.enroll',
        objectId: targetUser.userId,
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.actorUserId).toBe(userId);
      expect(auditEntry!.actorRole).toBe('administrator');
      expect(auditEntry!.objectType).toBe('face_enrollment');
      expect(auditEntry!.newValue?.sample_count).toBe(3);
      expect(auditEntry!.newValue?.consent_given).toBe(true);
    });

    it('sends all enrollment fields to the worker including overwrite flag', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'wm_enroll2', 'VisionPass1234!', 'WM Enroll 2', ['administrator']
      );

      const targetUserId = new ObjectId().toString();
      const workerPayload = {
        ok: true,
        enrollment: { user_id: targetUserId, sample_count: 4, status: 'overwritten' },
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, workerPayload));

      await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: targetUserId,
          image_samples: ['img1==', 'img2==', 'img3==', 'img4=='],
          consent_metadata: { consent_given: true, consent_actor: 'admin' },
          overwrite: true,
        });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe(`${MOCK_WORKER_URL}/api/v1/vision/enroll`);
      const sentBody = JSON.parse(calledOptions.body as string);
      expect(sentBody.user_id).toBe(targetUserId);
      expect(sentBody.image_samples).toHaveLength(4);
      expect(sentBody.consent_metadata.consent_given).toBe(true);
      expect(sentBody.overwrite).toBe(true);
    });

    it('still writes audit log when worker returns a failure status (attempt is always recorded)', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'wm_enroll3', 'VisionPass1234!', 'WM Enroll 3', ['administrator']
      );

      const targetUserId = new ObjectId().toString();

      // Worker returns 422 — enrollment failed (e.g. poor image quality)
      const workerPayload = {
        ok: false,
        error: 'POOR_IMAGE_QUALITY',
        message: 'All samples failed quality check',
      };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(422, workerPayload));

      const res = await request(app)
        .post('/api/v1/vision/enroll')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          user_id: targetUserId,
          image_samples: ['bad1==', 'bad2==', 'bad3=='],
          consent_metadata: { consent_given: true, consent_actor: userId },
        });

      // API proxies the worker status verbatim
      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe('POOR_IMAGE_QUALITY');

      // The audit log IS written even on worker failure — the route calls
      // writeAuditLog unconditionally after any successful proxy response,
      // recording the admin's intent regardless of the worker's outcome.
      const db = getTestDb();
      const auditEntry = await db.collection('audit_logs').findOne({
        action: 'vision.enroll',
        objectId: targetUserId,
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.actorUserId).toBe(userId);
      expect(auditEntry!.newValue?.sample_count).toBe(3);
    });
  });
});
