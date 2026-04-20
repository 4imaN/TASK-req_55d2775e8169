import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
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

/** Fund a user via the admin topup endpoint and return the ledger entry id */
async function fundUser(
  adminCookies: string[],
  adminCsrf: string,
  userId: string,
  amountCents = 5000
): Promise<string> {
  const topupRes = await request(app)
    .post('/api/v1/wallet/topup')
    .set('Cookie', adminCookies)
    .set('x-csrf-token', adminCsrf)
    .send({ userId, amountCents, description: 'Test fund', idempotencyKey: `fund-${new ObjectId().toString()}` });

  expect(topupRes.status).toBe(200);

  // Fetch the ledger entry id from DB
  const db = getTestDb();
  const entry = await db.collection('ledger_entries').findOne({ userId }) as any;
  return entry._id.toString();
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

describe('Dispute API', () => {
  describe('POST /api/v1/wallet/disputes', () => {
    it('creates a dispute for own ledger entry', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'dispuser1', 'DispPass1234!', 'Disp User 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'dispadmin1', 'AdminPass1234!', 'Disp Admin 1', ['administrator']
      );

      const ledgerEntryId = await fundUser(adminCookies, adminCsrf, userId);

      const res = await request(app)
        .post('/api/v1/wallet/disputes')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          ledgerEntryId,
          reason: 'I did not authorize this charge to my account.',
          idempotencyKey: `dispute-create-${new ObjectId().toString()}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.status).toBe('open');
      expect(res.body.data.userId).toBe(userId);
    });

    it('rejects short reason', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'dispuser2', 'DispPass1234!', 'Disp User 2'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'dispadmin2', 'AdminPass1234!', 'Disp Admin 2', ['administrator']
      );

      const ledgerEntryId = await fundUser(adminCookies, adminCsrf, userId);

      const res = await request(app)
        .post('/api/v1/wallet/disputes')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          ledgerEntryId,
          reason: 'Bad',   // too short — must be >= 10 chars
          idempotencyKey: `dispute-short-${new ObjectId().toString()}`,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('requires all fields', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'dispuser3', 'DispPass1234!', 'Disp User 3'
      );

      const res = await request(app)
        .post('/api/v1/wallet/disputes')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ reason: 'Missing ledgerEntryId and idempotencyKey here.' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/wallet/disputes', () => {
    it('admin can list disputes', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'dispuser4', 'DispPass1234!', 'Disp User 4'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'dispadmin3', 'AdminPass1234!', 'Disp Admin 3', ['administrator']
      );

      const ledgerEntryId = await fundUser(adminCookies, adminCsrf, userId);

      await request(app)
        .post('/api/v1/wallet/disputes')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          ledgerEntryId,
          reason: 'Unauthorized charge disputed by account holder.',
          idempotencyKey: `dispute-list-${new ObjectId().toString()}`,
        });

      const listRes = await request(app)
        .get('/api/v1/wallet/disputes')
        .set('Cookie', adminCookies);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies } = await registerAndLogin('dispuser5', 'DispPass1234!', 'Disp User 5');

      const res = await request(app)
        .get('/api/v1/wallet/disputes')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/wallet/disputes/:id', () => {
    it('admin can update dispute status open → under_review', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'dispuser6', 'DispPass1234!', 'Disp User 6'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'dispadmin4', 'AdminPass1234!', 'Disp Admin 4', ['administrator']
      );

      const ledgerEntryId = await fundUser(adminCookies, adminCsrf, userId);

      const createRes = await request(app)
        .post('/api/v1/wallet/disputes')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          ledgerEntryId,
          reason: 'This transaction was made without my knowledge or consent.',
          idempotencyKey: `dispute-update-${new ObjectId().toString()}`,
        });

      expect(createRes.status).toBe(201);
      const disputeId = createRes.body.data._id as string;

      const updateRes = await request(app)
        .put(`/api/v1/wallet/disputes/${disputeId}`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ status: 'under_review', internalNotes: 'Reviewing transaction logs' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.status).toBe('under_review');
    });

    it('rejects invalid status transition', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'dispuser7', 'DispPass1234!', 'Disp User 7'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'dispadmin5', 'AdminPass1234!', 'Disp Admin 5', ['administrator']
      );

      const ledgerEntryId = await fundUser(adminCookies, adminCsrf, userId);

      const createRes = await request(app)
        .post('/api/v1/wallet/disputes')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          ledgerEntryId,
          reason: 'Dispute for transition validation test scenario.',
          idempotencyKey: `dispute-bad-transition-${new ObjectId().toString()}`,
        });

      expect(createRes.status).toBe(201);
      const disputeId = createRes.body.data._id as string;

      // Attempt invalid transition: open → resolved_user (requires going through under_review first)
      const badRes = await request(app)
        .put(`/api/v1/wallet/disputes/${disputeId}`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ status: 'resolved_user' });

      expect(badRes.status).toBe(400);
      expect(badRes.body.ok).toBe(false);
    });
  });
});
