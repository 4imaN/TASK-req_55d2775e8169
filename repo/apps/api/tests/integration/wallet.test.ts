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

describe('Wallet API', () => {
  describe('POST /api/v1/wallet/topup', () => {
    it('creates a ledger entry and increases balance', async () => {
      const { userId } = await registerAndLogin(
        'walletuser1', 'WalletPass1234!', 'Wallet User 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin1', 'AdminPass1234!', 'Wallet Admin 1', ['administrator']
      );

      const topupRes = await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({
          userId,
          amountCents: 5000,
          description: 'Test top-up',
          idempotencyKey: 'topup-1',
        });

      expect(topupRes.status).toBe(200);
      expect(topupRes.body.ok).toBe(true);
      expect(topupRes.body.data.balanceCents).toBe(5000);

      // Verify via balance endpoint
      const db = getTestDb();
      const { cookies: userCookies } = await (async () => {
        const ag = createAgent();
        const csrf = await getCsrf(ag) as string;
        const loginRes = await ag
          .post('/api/v1/auth/login')
          .set('x-csrf-token', csrf)
          .send({ username: 'walletuser1', password: 'WalletPass1234!' });
        return { cookies: loginRes.headers['set-cookie'] as unknown as string[] };
      })();

      const balRes = await request(app)
        .get('/api/v1/wallet/balance')
        .set('Cookie', userCookies);
      expect(balRes.status).toBe(200);
      expect(balRes.body.data.balanceCents).toBe(5000);

      // Verify ledger entry was created
      const ledger = await db.collection('ledger_entries').find({ userId }).toArray();
      expect(ledger).toHaveLength(1);
      expect((ledger[0] as any).type).toBe('topup');
      expect((ledger[0] as any).amountCents).toBe(5000);
    });

    it('is idempotent for duplicate key', async () => {
      const { userId } = await registerAndLogin(
        'walletuser2', 'WalletPass1234!', 'Wallet User 2'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin2', 'AdminPass1234!', 'Wallet Admin 2', ['administrator']
      );

      const topup1 = await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 3000, description: 'Dup top-up', idempotencyKey: 'topup-dup-1' });
      expect(topup1.status).toBe(200);
      expect(topup1.body.data.balanceCents).toBe(3000);

      const topup2 = await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 3000, description: 'Dup top-up', idempotencyKey: 'topup-dup-1' });
      expect(topup2.status).toBe(200);
      // Balance should still be 3000, not 6000
      expect(topup2.body.data.balanceCents).toBe(3000);

      const db = getTestDb();
      const ledger = await db.collection('ledger_entries').find({ userId }).toArray();
      expect(ledger).toHaveLength(1);
    });
  });

  describe('POST /api/v1/wallet/spend', () => {
    it('reduces balance on spend', async () => {
      const { userId } = await registerAndLogin(
        'walletspend1', 'WalletPass1234!', 'Wallet Spend 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin3', 'AdminPass1234!', 'Wallet Admin 3', ['administrator']
      );

      // Fund the account
      await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 10000, description: 'Initial', idempotencyKey: 'spend-setup-1' });

      const spendRes = await request(app)
        .post('/api/v1/wallet/spend')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({
          userId,
          amountCents: 3000,
          description: 'Room booking',
          idempotencyKey: 'spend-1',
        });

      expect(spendRes.status).toBe(200);
      expect(spendRes.body.ok).toBe(true);
      expect(spendRes.body.data.balanceCents).toBe(7000);
    });

    it('fails on insufficient balance', async () => {
      const { userId } = await registerAndLogin(
        'walletspend2', 'WalletPass1234!', 'Wallet Spend 2'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin4', 'AdminPass1234!', 'Wallet Admin 4', ['administrator']
      );

      // Fund only 500 cents
      await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 500, description: 'Small fund', idempotencyKey: 'insuff-setup-1' });

      const spendRes = await request(app)
        .post('/api/v1/wallet/spend')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({
          userId,
          amountCents: 1000,
          description: 'Too expensive',
          idempotencyKey: 'spend-insuff-1',
        });

      expect(spendRes.status).toBe(400);
      expect(spendRes.body.ok).toBe(false);
      expect(spendRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('enforces daily risk limit', async () => {
      const { userId } = await registerAndLogin(
        'walletrisk1', 'WalletPass1234!', 'Wallet Risk 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin5', 'AdminPass1234!', 'Wallet Admin 5', ['administrator']
      );

      // Fund up to the daily risk limit (default $200.00 = 20000 cents)
      await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 19000, description: 'Near limit', idempotencyKey: 'risk-setup-1' });

      // This next topup pushes daily usage to 19000 + 2000 = 21000, exceeding 20000 limit
      const limitRes = await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 2000, description: 'Over limit', idempotencyKey: 'risk-over-1' });

      expect(limitRes.status).toBe(400);
      expect(limitRes.body.ok).toBe(false);
      expect(limitRes.body.error.message).toMatch(/risk limit/i);
    });
  });

  describe('POST /api/v1/wallet/redeem-points', () => {
    it('redeems points in 100-block multiples', async () => {
      const { userId, cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'walletpoints1', 'WalletPass1234!', 'Wallet Points 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin6', 'AdminPass1234!', 'Wallet Admin 6', ['administrator']
      );

      // Give user some points by updating the existing membership account created at registration
      const db = getTestDb();
      await db.collection('membership_accounts').updateOne(
        { userId },
        { $set: { pointsBalance: 500, updatedAt: new Date() } }
      );

      const redeemRes = await request(app)
        .post('/api/v1/wallet/redeem-points')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ pointsToRedeem: 300, idempotencyKey: 'redeem-points-1' });

      expect(redeemRes.status).toBe(200);
      expect(redeemRes.body.ok).toBe(true);
      // 300 points / 100 block * 100 cents = 300 cents credit
      expect(redeemRes.body.data.balanceCents).toBe(300);
      expect(redeemRes.body.data.pointsBalance).toBe(200); // 500 - 300
    });

    it('rejects points not in 100-block multiples', async () => {
      const { userId, cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'walletpoints2', 'WalletPass1234!', 'Wallet Points 2'
      );

      const db = getTestDb();
      await db.collection('membership_accounts').updateOne(
        { userId },
        { $set: { pointsBalance: 500, updatedAt: new Date() } }
      );

      const redeemRes = await request(app)
        .post('/api/v1/wallet/redeem-points')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ pointsToRedeem: 150, idempotencyKey: 'redeem-invalid-1' }); // 150 not a multiple of 100

      expect(redeemRes.status).toBe(400);
      expect(redeemRes.body.ok).toBe(false);
      expect(redeemRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Ledger immutability', () => {
    it('ledger entries are never deleted', async () => {
      const { userId } = await registerAndLogin(
        'walletimm1', 'WalletPass1234!', 'Wallet Immutable 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin7', 'AdminPass1234!', 'Wallet Admin 7', ['administrator']
      );

      await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 2000, description: 'Immutable test', idempotencyKey: 'imm-1' });

      await request(app)
        .post('/api/v1/wallet/spend')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 500, description: 'Spend test', idempotencyKey: 'imm-spend-1' });

      // Verify both entries still exist in DB
      const db = getTestDb();
      const entries = await db.collection('ledger_entries').find({ userId }).toArray();
      expect(entries.length).toBe(2);

      // Verify types
      const types = entries.map((e: any) => e.type);
      expect(types).toContain('topup');
      expect(types).toContain('spend');
    });
  });

  describe('GET /api/v1/wallet/ledger', () => {
    it('returns paginated ledger entries for the user', async () => {
      const { userId, cookies: userCookies } = await registerAndLogin(
        'walletledger1', 'WalletPass1234!', 'Wallet Ledger 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin8', 'AdminPass1234!', 'Wallet Admin 8', ['administrator']
      );

      // Create multiple entries
      for (let i = 1; i <= 3; i++) {
        await request(app)
          .post('/api/v1/wallet/topup')
          .set('Cookie', adminCookies)
          .set('x-csrf-token', adminCsrf)
          .send({ userId, amountCents: 1000, description: `Top-up ${i}`, idempotencyKey: `ledger-topup-${i}` });
      }

      const ledgerRes = await request(app)
        .get('/api/v1/wallet/ledger')
        .set('Cookie', userCookies);

      expect(ledgerRes.status).toBe(200);
      expect(ledgerRes.body.ok).toBe(true);
      expect(Array.isArray(ledgerRes.body.data)).toBe(true);
      expect(ledgerRes.body.data.length).toBe(3);
      expect(ledgerRes.body.meta.total).toBe(3);
    });
  });

  describe('POST /api/v1/wallet/refund', () => {
    it('refunds a spend entry and restores the balance', async () => {
      const { userId } = await registerAndLogin(
        'walletrefund1', 'WalletPass1234!', 'Wallet Refund 1'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin9', 'AdminPass1234!', 'Wallet Admin 9', ['administrator']
      );

      // Fund the account
      await request(app)
        .post('/api/v1/wallet/topup')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 8000, description: 'Refund test fund', idempotencyKey: 'refund-fund-1' });

      // Spend some funds
      const spendRes = await request(app)
        .post('/api/v1/wallet/spend')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ userId, amountCents: 3000, description: 'Room booking charge', idempotencyKey: 'refund-spend-1' });
      expect(spendRes.status).toBe(200);
      expect(spendRes.body.data.balanceCents).toBe(5000);

      // Retrieve the spend ledger entry id
      const db = getTestDb();
      const spendEntry = await db.collection('ledger_entries').findOne({ userId, type: 'spend' }) as any;
      expect(spendEntry).not.toBeNull();
      const spendEntryId = spendEntry._id.toString();

      // Refund the spend
      const refundRes = await request(app)
        .post('/api/v1/wallet/refund')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({
          userId,
          originalEntryId: spendEntryId,
          amountCents: 3000,
          description: 'Refund for cancelled booking',
          idempotencyKey: 'refund-1',
        });

      expect(refundRes.status).toBe(200);
      expect(refundRes.body.ok).toBe(true);
      // Balance should be restored to 8000
      expect(refundRes.body.data.balanceCents).toBe(8000);

      // Verify a refund ledger entry was created
      const refundEntry = await db.collection('ledger_entries').findOne({ userId, type: 'refund' }) as any;
      expect(refundEntry).not.toBeNull();
      expect(refundEntry.amountCents).toBe(3000);
    });

    it('rejects refund of a nonexistent spend entry', async () => {
      const { userId } = await registerAndLogin(
        'walletrefund2', 'WalletPass1234!', 'Wallet Refund 2'
      );
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'walletadmin10', 'AdminPass1234!', 'Wallet Admin 10', ['administrator']
      );

      const fakeEntryId = new ObjectId().toString();

      const refundRes = await request(app)
        .post('/api/v1/wallet/refund')
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({
          userId,
          spendEntryId: fakeEntryId,
          description: 'Refund for nonexistent entry',
          idempotencyKey: 'refund-notfound-1',
        });

      expect([400, 404, 422]).toContain(refundRes.status);
      expect(refundRes.body.ok).toBe(false);
    });
  });
});
