import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

// ── Helpers ────────────────────────────────────────────────────────────────────

function createAgent() {
  return request.agent(app);
}

async function getCsrf(agent?: ReturnType<typeof request.agent>): Promise<string> {
  const res = await (agent || createAgent()).get('/api/v1/auth/csrf');
  return res.body.data.csrfToken as string;
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ cookies: string[]; csrfToken: string; userId: string }> {
  const ag = createAgent();
  const csrf1 = await getCsrf(ag);
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

  const csrf2 = await getCsrf(ag);
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

describe('Audit Logs API', () => {
  describe('GET /api/v1/audit-logs/verify', () => {
    it('returns { valid: true } for admin with an empty chain', async () => {
      const { cookies } = await registerAndLogin(
        'auditadmin1', 'AuditPass1234!', 'Audit Admin 1', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/audit-logs/verify')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.valid).toBe(true);
    });

    it('returns 403 for a non-admin user', async () => {
      const { cookies } = await registerAndLogin(
        'audituser1', 'AuditPass1234!', 'Audit User 1'
      );

      const res = await request(app)
        .get('/api/v1/audit-logs/verify')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/v1/audit-logs/verify');
      expect(res.status).toBe(401);
    });

    it('chain remains valid after register and login actions produce audit entries', async () => {
      const { cookies: adminCookies } = await registerAndLogin(
        'auditadmin2', 'AuditPass1234!', 'Audit Admin 2', ['administrator']
      );

      // Perform additional actions that trigger audit log writes
      await registerAndLogin('auditactor1', 'AuditPass1234!', 'Audit Actor 1');
      await registerAndLogin('auditactor2', 'AuditPass1234!', 'Audit Actor 2');

      const res = await request(app)
        .get('/api/v1/audit-logs/verify')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.valid).toBe(true);
    });
  });

  describe('GET /api/v1/audit-logs', () => {
    it('returns paginated audit logs for admin', async () => {
      const { cookies } = await registerAndLogin(
        'auditadmin3', 'AuditPass1234!', 'Audit Admin 3', ['administrator']
      );

      // Seed some audit entries via the service
      const { writeAuditLog } = await import('../../src/services/audit.service');
      await writeAuditLog({
        actorUserId: 'test-actor',
        actorRole: 'administrator',
        action: 'test.action.one',
        objectType: 'test_object',
        objectId: 'obj-001',
        requestId: 'req-audit-001',
      });
      await writeAuditLog({
        actorUserId: 'test-actor',
        actorRole: 'administrator',
        action: 'test.action.two',
        objectType: 'test_object',
        objectId: 'obj-002',
        requestId: 'req-audit-002',
      });

      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta).toBeDefined();
      expect(typeof res.body.meta.total).toBe('number');
    });

    it('returns 403 for non-admin user', async () => {
      const { cookies } = await registerAndLogin(
        'audituser2', 'AuditPass1234!', 'Audit User 2'
      );

      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('filters audit logs by action query param', async () => {
      const { cookies } = await registerAndLogin(
        'auditadmin4', 'AuditPass1234!', 'Audit Admin 4', ['administrator']
      );

      const { writeAuditLog } = await import('../../src/services/audit.service');
      await writeAuditLog({
        actorUserId: 'filter-actor',
        actorRole: 'administrator',
        action: 'unique.filter.action',
        objectType: 'filter_object',
        objectId: 'filter-obj-1',
        requestId: 'req-filter-001',
      });

      const res = await request(app)
        .get('/api/v1/audit-logs?action=unique.filter.action')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      // At least the one we inserted should match
      const actions = res.body.data.map((d: any) => d.action);
      expect(actions.some((a: string) => a === 'unique.filter.action')).toBe(true);
    });

    it('chain is still valid after multiple actions including room-related writes', async () => {
      const { cookies: adminCookies } = await registerAndLogin(
        'auditadmin5', 'AuditPass1234!', 'Audit Admin 5', ['administrator']
      );

      const { writeAuditLog } = await import('../../src/services/audit.service');
      // Write a sequence of audit entries
      for (let i = 0; i < 5; i++) {
        await writeAuditLog({
          actorUserId: 'chain-actor',
          actorRole: 'administrator',
          action: `chain.action.${i}`,
          objectType: 'chain_test',
          objectId: `obj-chain-${i}`,
          requestId: `req-chain-${i}`,
        });
      }

      const verifyRes = await request(app)
        .get('/api/v1/audit-logs/verify')
        .set('Cookie', adminCookies);

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(true);
    });
  });
});
