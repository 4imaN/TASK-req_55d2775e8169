import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestApp, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function createAgent() {
  return request.agent(app);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

describe('Export API', () => {
  describe('POST /api/v1/exports', () => {
    it('creates an export job (admin only)', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'exportadmin1', 'ExportPass1234!', 'Export Admin', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'reservations', filters: {} });

      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.exportType).toBe('reservations');
      expect(res.body.data.status).toBeDefined();
    });

    it('non-admin cannot create export (403)', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'exportuser1', 'ExportPass1234!', 'Export User'
      );

      const res = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'reservations', filters: {} });

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
    });

    it('creates an export job with reservations type', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'exportadmin2', 'ExportPass1234!', 'Export Admin 2', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          exportType: 'reservations',
          filters: {
            startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            endDate: new Date().toISOString(),
          },
        });

      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.exportType).toBe('reservations');

      // Verify job is persisted in DB
      const db = getTestDb();
      const job = await db.collection('export_jobs').findOne({
        _id: new ObjectId(res.body.data._id),
      }) as any;
      expect(job).toBeTruthy();
      expect(job.exportType).toBe('reservations');
      expect(job.requestedByUserId).toBe(userId);
    });
  });

  describe('GET /api/v1/exports', () => {
    it('lists export jobs for admin', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'exportadmin3', 'ExportPass1234!', 'Export Admin 3', ['administrator']
      );

      // Create two export jobs
      await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'reservations', filters: {} });

      await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'attendance', filters: {} });

      const listRes = await request(app)
        .get('/api/v1/exports')
        .set('Cookie', cookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
      expect(listRes.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('non-admin cannot list exports (403)', async () => {
      const { cookies } = await registerAndLogin(
        'exportuser2', 'ExportPass1234!', 'Export User 2'
      );

      const res = await request(app)
        .get('/api/v1/exports')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('Export processing and download', () => {
    it('processes an export job to completion with file hash', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'exportadmin4', 'ExportPass1234!', 'Export Admin 4', ['administrator']
      );

      // Create an export job
      const createRes = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'reservations', filters: {} });
      expect(createRes.status).toBe(202);
      const jobId = createRes.body.data._id;

      // Manually process the export job
      const { processExportJob } = await import('../../src/services/export.service');
      await processExportJob(jobId);

      // Verify job is now completed with fileHash populated
      const statusRes = await request(app)
        .get(`/api/v1/exports/${jobId}`)
        .set('Cookie', cookies);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data.status).toBe('completed');
      expect(statusRes.body.data.fileHash).toBeTruthy();
      expect(typeof statusRes.body.data.fileHash).toBe('string');
      expect(statusRes.body.data.fileHash.length).toBe(64); // SHA-256 hex
      expect(statusRes.body.data.filePath).toBeTruthy();
    });

    it('serves completed export as CSV download with hash header', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'exportadmin5', 'ExportPass1234!', 'Export Admin 5', ['administrator']
      );

      // Create and process
      const createRes = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'reservations', filters: {} });
      const jobId = createRes.body.data._id;

      const { processExportJob } = await import('../../src/services/export.service');
      await processExportJob(jobId);

      // Download the file
      const dlRes = await request(app)
        .get(`/api/v1/exports/${jobId}/download`)
        .set('Cookie', cookies);

      expect(dlRes.status).toBe(200);
      expect(dlRes.headers['content-type']).toMatch(/text\/csv/);
      expect(dlRes.headers['x-file-hash-sha256']).toBeTruthy();
      expect(dlRes.headers['x-file-hash-sha256'].length).toBe(64);
      // CSV should contain the export header
      expect(dlRes.text).toContain('# StudyRoomOps Export');
      expect(dlRes.text).toContain('# Type: reservations');
    });

    it('rejects download of non-completed export', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'exportadmin6', 'ExportPass1234!', 'Export Admin 6', ['administrator']
      );

      // Create but do NOT process
      const createRes = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ exportType: 'reservations', filters: {} });
      const jobId = createRes.body.data._id;

      // Attempt to download before processing
      const dlRes = await request(app)
        .get(`/api/v1/exports/${jobId}/download`)
        .set('Cookie', cookies);

      expect(dlRes.status).toBe(400);
      expect(dlRes.body.ok).toBe(false);
    });

    it('non-admin cannot download export (403)', async () => {
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'exportadmin7', 'ExportPass1234!', 'Export Admin 7', ['administrator']
      );
      const { cookies: userCookies } = await registerAndLogin(
        'exportuser3', 'ExportPass1234!', 'Export User 3'
      );

      // Admin creates and processes
      const createRes = await request(app)
        .post('/api/v1/exports')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ exportType: 'reservations', filters: {} });
      const jobId = createRes.body.data._id;

      const { processExportJob } = await import('../../src/services/export.service');
      await processExportJob(jobId);

      // Non-admin attempts to download
      const dlRes = await request(app)
        .get(`/api/v1/exports/${jobId}/download`)
        .set('Cookie', userCookies);

      expect(dlRes.status).toBe(403);
    });
  });
});
