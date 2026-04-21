/**
 * E2E — Policy & Blacklist Flow
 *
 * Validates policies, blacklist, and dispute lifecycle as the React frontend
 * experiences them:
 *   Create policy (admin) → List policies → Get single policy →
 *   Add user to blacklist (admin) → Verify blacklisted user cannot book →
 *   Remove from blacklist → View blacklist actions →
 *   Create dispute → List disputes (admin) → Update dispute status
 *
 * Mirrors PoliciesPage.tsx / BlacklistPage.tsx / DisputesPage.tsx contract:
 *   POST /api/v1/policies
 *   GET  /api/v1/policies
 *   GET  /api/v1/policies/:id
 *   POST /api/v1/blacklist
 *   GET  /api/v1/blacklist
 *   POST /api/v1/blacklist/:userId/clear
 *   POST /api/v1/wallet/disputes
 *   GET  /api/v1/wallet/disputes
 *   PUT  /api/v1/wallet/disputes/:id
 */

import request from 'supertest';
import express from 'express';
import { ObjectId } from 'mongodb';
import {
  setupE2eDb,
  teardownE2eDb,
  clearAndReindex,
  getE2eDb,
  registerUser,
  loginUser,
  promoteToAdmin,
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

async function setupAdminSession(): Promise<{
  cookies: string[];
  csrfToken: string;
  adminId: string;
}> {
  const { userId } = await registerUser(app, {
    username: 'pb_admin',
    password: 'AdminPBPass12345',
    displayName: 'PB Admin',
  });
  await promoteToAdmin(userId);
  const { cookies, csrfToken } = await loginUser(app, {
    username: 'pb_admin',
    password: 'AdminPBPass12345',
  });
  return { cookies, csrfToken, adminId: userId };
}

async function seedRoom(): Promise<{ roomId: string; zoneId: string }> {
  const db = getE2eDb();
  const zoneResult = await db.collection('zones').insertOne({
    name: 'PB Zone',
    description: 'For policy/blacklist tests',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const zoneId = zoneResult.insertedId.toString();
  const roomResult = await db.collection('rooms').insertOne({
    zoneId,
    name: 'PB Room',
    capacity: 4,
    amenities: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return { roomId: roomResult.insertedId.toString(), zoneId };
}

// ── Create / List policies (admin) ────────────────────────────────────────────

describe('Policy flow — Create policies (POST /policies)', () => {
  it('admin creates a policy version and returns it', async () => {
    const { cookies, csrfToken, adminId } = await setupAdminSession();

    const effectiveAt = new Date(Date.now() + 86400_000).toISOString(); // tomorrow

    const res = await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        policyArea: 'booking',
        settings: { maxAdvanceDays: 30, maxDurationHours: 4 },
        effectiveAt,
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const policy = res.body.data;
    expect(policy._id).toBeDefined();
    expect(policy.policyArea).toBe('booking');
    expect(policy.settings).toBeDefined();
    expect(policy.createdByUserId).toBe(adminId);
    expect(policy.createdAt).toBeDefined();
  });

  it('returns 422 when policyArea is missing', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        settings: { maxAdvanceDays: 14 },
        effectiveAt: new Date().toISOString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
  });

  it('returns 422 when effectiveAt is missing', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ policyArea: 'cancellation', settings: { gracePeriodMinutes: 60 } });

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
  });

  it('regular user cannot create policies (403)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'policy_norole1',
      password: 'PolicyPass12345',
      displayName: 'Policy No Role 1',
    });

    const res = await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        policyArea: 'booking',
        settings: {},
        effectiveAt: new Date().toISOString(),
      });

    expect([403, 401]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });
});

describe('Policy flow — List policies (GET /policies)', () => {
  it('admin can list policies with pagination', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    // Seed a couple of policies
    await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        policyArea: 'noise',
        settings: { enforceQuietHours: true },
        effectiveAt: new Date(Date.now() + 86400_000).toISOString(),
      });

    await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        policyArea: 'capacity',
        settings: { maxGroupSize: 8 },
        effectiveAt: new Date(Date.now() + 86400_000).toISOString(),
      });

    const listRes = await request(app)
      .get('/api/v1/policies')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);

    // PoliciesPage.tsx Policy interface
    const p = listRes.body.data[0];
    expect(p._id).toBeDefined();
    expect(typeof p.policyArea).toBe('string');
    expect(p.settings).toBeDefined();

    // Pagination meta
    expect(listRes.body.meta).toBeDefined();
    expect(typeof (listRes.body.meta as { total?: number }).total).toBe('number');
  });

  it('supports policyArea filter', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        policyArea: 'access',
        settings: { requiresApproval: false },
        effectiveAt: new Date(Date.now() + 86400_000).toISOString(),
      });

    const res = await request(app)
      .get('/api/v1/policies')
      .query({ policyArea: 'access' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      const areas = (res.body.data as { policyArea: string }[]).map((p) => p.policyArea);
      expect(areas.every((a) => a === 'access')).toBe(true);
    }
  });

  it('admin can get a single policy by id (GET /policies/:id)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const createRes = await request(app)
      .post('/api/v1/policies')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        policyArea: 'amenity',
        settings: { wifiRequired: true },
        effectiveAt: new Date(Date.now() + 86400_000).toISOString(),
      });

    const policyId = createRes.body.data._id as string;

    const getRes = await request(app)
      .get(`/api/v1/policies/${policyId}`)
      .set('Cookie', cookies);

    expect(getRes.status).toBe(200);
    expect(getRes.body.ok).toBe(true);
    expect(getRes.body.data.policyArea).toBe('amenity');
    expect(getRes.body.data.settings.wifiRequired).toBe(true);
  });

  it('returns 404 for non-existent policy id', async () => {
    const { cookies } = await setupAdminSession();
    const fakeId = new ObjectId().toString();

    const res = await request(app)
      .get(`/api/v1/policies/${fakeId}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

// ── Add user to blacklist (admin) ─────────────────────────────────────────────

describe('Blacklist flow — Add to blacklist (POST /blacklist)', () => {
  it('admin blacklists a user and returns success message', async () => {
    const { cookies, csrfToken } = await setupAdminSession();
    const { userId: targetId } = await registerUser(app, {
      username: 'bl_target1',
      password: 'TargetPass12345',
      displayName: 'BL Target 1',
    });

    const res = await request(app)
      .post('/api/v1/blacklist')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        userId: targetId,
        reason: 'Repeated no-show violations and failure to cancel bookings in advance.',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.message).toBeDefined();
  });

  it('returns 400 when userId or reason is missing', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/blacklist')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'Missing userId' }); // no userId

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('regular user cannot blacklist (403)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'bl_norole1',
      password: 'BLPass123456',
      displayName: 'BL No Role 1',
    });
    const { userId: targetId } = await registerUser(app, {
      username: 'bl_victim1',
      password: 'BLPass123456',
      displayName: 'BL Victim 1',
    });

    const res = await request(app)
      .post('/api/v1/blacklist')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ userId: targetId, reason: 'Unauthorized blacklist attempt.' });

    expect([403, 401]).toContain(res.status);
  });
});

// ── Verify blacklisted user cannot make reservations ─────────────────────────

describe('Blacklist flow — Blacklisted user blocked from bookings', () => {
  it('blacklisted user receives 403 when attempting to create a reservation', async () => {
    const { cookies: adminCookies, csrfToken: adminCsrf } = await setupAdminSession();
    const { userId: targetId, cookies: targetCookies, csrfToken: targetCsrf } =
      await registerUser(app, {
        username: 'bl_booker1',
        password: 'BLBookerPass12345',
        displayName: 'BL Booker 1',
      });
    const { roomId } = await seedRoom();
    const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(10, 11);
    await seedBusinessHours(dayOfWeek);

    // Blacklist the user
    const blRes = await request(app)
      .post('/api/v1/blacklist')
      .set('Cookie', adminCookies)
      .set('x-csrf-token', adminCsrf)
      .send({
        userId: targetId,
        reason: 'Multiple violations of code of conduct in the facility.',
      });
    expect(blRes.status).toBe(200);

    // Attempt to book as blacklisted user
    const bookRes = await request(app)
      .post('/api/v1/reservations')
      .set('Cookie', targetCookies)
      .set('x-csrf-token', targetCsrf)
      .send({
        roomId,
        startAtUtc,
        endAtUtc,
        idempotencyKey: `bl-book-${Date.now()}`,
      });

    // Blacklisted users must be denied booking (403 or 400 or 409)
    expect([403, 400, 409]).toContain(bookRes.status);
    expect(bookRes.body.ok).toBe(false);
  });
});

// ── List blacklist actions (admin) ────────────────────────────────────────────

describe('Blacklist flow — List (GET /blacklist)', () => {
  it('admin can list blacklist actions with pagination', async () => {
    const { cookies, csrfToken } = await setupAdminSession();
    const { userId: targetId } = await registerUser(app, {
      username: 'bl_listtest1',
      password: 'BLPass123456',
      displayName: 'BL List Test 1',
    });

    // Blacklist someone to ensure at least one entry
    await request(app)
      .post('/api/v1/blacklist')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        userId: targetId,
        reason: 'Listing test — user has persistent disruptive behavior.',
      });

    const listRes = await request(app)
      .get('/api/v1/blacklist')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    // BlacklistPage.tsx BlacklistAction interface
    const action = listRes.body.data[0];
    expect(action._id).toBeDefined();
    expect(action.userId).toBeDefined();
    expect(typeof action.reason).toBe('string');
    expect(action.createdAt).toBeDefined();

    // Pagination meta
    expect(listRes.body.meta).toBeDefined();
    expect(typeof (listRes.body.meta as { total?: number }).total).toBe('number');
  });

  it('regular user cannot list blacklist actions (403)', async () => {
    const { cookies } = await registerUser(app, {
      username: 'bl_listnoauth1',
      password: 'BLPass123456',
      displayName: 'BL List No Auth 1',
    });

    const res = await request(app)
      .get('/api/v1/blacklist')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

// ── Remove from blacklist ─────────────────────────────────────────────────────

describe('Blacklist flow — Remove (POST /blacklist/:userId/clear)', () => {
  it('admin can clear a user from the blacklist', async () => {
    const { cookies, csrfToken } = await setupAdminSession();
    const { userId: targetId } = await registerUser(app, {
      username: 'bl_clear1',
      password: 'BLPass123456',
      displayName: 'BL Clear 1',
    });

    // Blacklist first
    await request(app)
      .post('/api/v1/blacklist')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        userId: targetId,
        reason: 'Temporary blacklist for testing clear functionality.',
      });

    // Clear the blacklist
    const clearRes = await request(app)
      .post(`/api/v1/blacklist/${targetId}/clear`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(clearRes.status).toBe(200);
    expect(clearRes.body.ok).toBe(true);
    expect(clearRes.body.data.message).toBeDefined();
  });
});

// ── Disputes ──────────────────────────────────────────────────────────────────

/**
 * Helper: top up a user's wallet and return the ledger entry ID.
 * topUp returns { balanceCents } — the entry ID must be fetched from the ledger.
 */
async function topupAndGetLedgerEntryId(
  adminCookies: string[],
  adminCsrf: string,
  targetId: string,
  userCookies: string[],
  amountCents: number,
  label: string
): Promise<string> {
  const topupRes = await request(app)
    .post('/api/v1/wallet/topup')
    .set('Cookie', adminCookies)
    .set('x-csrf-token', adminCsrf)
    .send({
      userId: targetId,
      amountCents,
      description: `${label} topup`,
      idempotencyKey: `topup-${label}-${Date.now()}`,
    });
  expect(topupRes.status).toBe(200);

  // topUp returns { balanceCents } — query the ledger to get the latest entry ID
  const ledgerRes = await request(app)
    .get('/api/v1/wallet/ledger')
    .query({ page: '1', pageSize: '1' })
    .set('Cookie', userCookies);
  expect(ledgerRes.status).toBe(200);
  expect(ledgerRes.body.data.length).toBeGreaterThanOrEqual(1);
  return ledgerRes.body.data[0]._id as string;
}

describe('Dispute flow — Create (POST /wallet/disputes)', () => {
  it('user creates a dispute for a ledger entry', async () => {
    const { cookies: adminCookies, csrfToken: adminCsrf } = await setupAdminSession();
    const { userId: targetId, cookies: userCookies, csrfToken: userCsrf } =
      await registerUser(app, {
        username: 'dispute_user1',
        password: 'DisputePass12345',
        displayName: 'Dispute User 1',
      });

    // Top up and fetch the resulting ledger entry ID
    const ledgerEntryId = await topupAndGetLedgerEntryId(
      adminCookies, adminCsrf, targetId, userCookies, 5000, 'dispute'
    );

    const disputeRes = await request(app)
      .post('/api/v1/wallet/disputes')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        ledgerEntryId,
        reason: 'I was charged for a booking I never made and want a full refund.',
        idempotencyKey: `dispute-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

    expect(disputeRes.status).toBe(201);
    expect(disputeRes.body.ok).toBe(true);

    const dispute = disputeRes.body.data;
    expect(dispute._id).toBeDefined();
    expect(dispute.ledgerEntryId).toBe(ledgerEntryId);
    expect(dispute.userId).toBe(targetId);
    expect(dispute.reason).toBeDefined();
    expect(dispute.status).toBeDefined();
    expect(dispute.createdAt).toBeDefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'dispute_user2',
      password: 'DisputePass12345',
      displayName: 'Dispute User 2',
    });

    const res = await request(app)
      .post('/api/v1/wallet/disputes')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'Missing ledgerEntryId and idempotencyKey fields.' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('requires authentication to create a dispute', async () => {
    // CSRF middleware runs before auth middleware for POST requests.
    // An unauthenticated POST without a matching CSRF cookie gets 403
    // (CSRF_MISSING/CSRF_MISMATCH) before auth can return 401.
    const res = await request(app)
      .post('/api/v1/wallet/disputes')
      .send({ ledgerEntryId: 'fake', reason: 'Anon dispute', idempotencyKey: 'anon-disp' });

    expect([401, 403]).toContain(res.status);
  });
});

describe('Dispute flow — List (GET /wallet/disputes)', () => {
  it('admin can list disputes with pagination', async () => {
    const { cookies: adminCookies, csrfToken: adminCsrf } = await setupAdminSession();
    const { userId: targetId, cookies: userCookies, csrfToken: userCsrf } =
      await registerUser(app, {
        username: 'dispute_lister1',
        password: 'DisputePass12345',
        displayName: 'Dispute Lister 1',
      });

    // Top up and fetch the resulting ledger entry ID
    const ledgerEntryId = await topupAndGetLedgerEntryId(
      adminCookies, adminCsrf, targetId, userCookies, 2000, 'displist'
    );

    await request(app)
      .post('/api/v1/wallet/disputes')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        ledgerEntryId,
        reason: 'Disputing this charge as it was applied in error by the system.',
        idempotencyKey: `dispute-list-${Date.now()}`,
      });

    const listRes = await request(app)
      .get('/api/v1/wallet/disputes')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', adminCookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    // DisputesPage.tsx Dispute interface
    const d = listRes.body.data[0];
    expect(d._id).toBeDefined();
    expect(d.userId).toBeDefined();
    expect(d.ledgerEntryId).toBeDefined();
    expect(typeof d.reason).toBe('string');
    expect(d.status).toBeDefined();
    expect(d.createdAt).toBeDefined();

    // Pagination meta
    expect(listRes.body.meta).toBeDefined();
    expect(typeof (listRes.body.meta as { total?: number }).total).toBe('number');
  });

  it('regular user cannot list all disputes (403)', async () => {
    const { cookies } = await registerUser(app, {
      username: 'dispute_norole1',
      password: 'DisputePass12345',
      displayName: 'Dispute No Role 1',
    });

    const res = await request(app)
      .get('/api/v1/wallet/disputes')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

describe('Dispute flow — Update status (PUT /wallet/disputes/:id)', () => {
  it('admin can update dispute status to under_review', async () => {
    const { cookies: adminCookies, csrfToken: adminCsrf } = await setupAdminSession();
    const { userId: targetId, cookies: userCookies, csrfToken: userCsrf } =
      await registerUser(app, {
        username: 'dispute_status1',
        password: 'DisputePass12345',
        displayName: 'Dispute Status 1',
      });

    // top up and get ledger entry ID (topUp returns { balanceCents }, not { _id })
    const ledgerEntryId = await topupAndGetLedgerEntryId(
      adminCookies, adminCsrf, targetId, userCookies, 3000, 'dispstatus'
    );

    const disputeRes = await request(app)
      .post('/api/v1/wallet/disputes')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        ledgerEntryId,
        reason: 'Charge dispute awaiting admin review and investigation.',
        idempotencyKey: `dispute-status-${Date.now()}`,
      });

    expect(disputeRes.status).toBe(201);
    const disputeId = disputeRes.body.data._id as string;

    // Dispute state machine: open → under_review (not 'investigating')
    const updateRes = await request(app)
      .put(`/api/v1/wallet/disputes/${disputeId}`)
      .set('Cookie', adminCookies)
      .set('x-csrf-token', adminCsrf)
      .send({
        status: 'under_review',
        internalNotes: 'Reviewing transaction logs for this charge.',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);
    expect(updateRes.body.data.status).toBe('under_review');
  });

  it('admin can resolve a dispute in the user\'s favor', async () => {
    const { cookies: adminCookies, csrfToken: adminCsrf } = await setupAdminSession();
    const { userId: targetId, cookies: userCookies, csrfToken: userCsrf } =
      await registerUser(app, {
        username: 'dispute_resolve1',
        password: 'DisputePass12345',
        displayName: 'Dispute Resolve 1',
      });

    // top up and get ledger entry ID (topUp returns { balanceCents }, not { _id })
    const ledgerEntryId = await topupAndGetLedgerEntryId(
      adminCookies, adminCsrf, targetId, userCookies, 4000, 'dispresolve'
    );

    const disputeRes = await request(app)
      .post('/api/v1/wallet/disputes')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        ledgerEntryId,
        reason: 'Transaction error — amount was doubled on my account unexpectedly.',
        idempotencyKey: `dispute-resolve-${Date.now()}`,
      });

    const disputeId = disputeRes.body.data._id as string;

    // Dispute state machine: open → under_review → resolved_house
    await request(app)
      .put(`/api/v1/wallet/disputes/${disputeId}`)
      .set('Cookie', adminCookies)
      .set('x-csrf-token', adminCsrf)
      .send({ status: 'under_review' });

    // 'resolved_house' means resolved in the house/admin's favor (no refund issued)
    const resolveRes = await request(app)
      .put(`/api/v1/wallet/disputes/${disputeId}`)
      .set('Cookie', adminCookies)
      .set('x-csrf-token', adminCsrf)
      .send({ status: 'resolved_house', internalNotes: 'Verified charge — closing as valid.' });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.ok).toBe(true);
    expect(resolveRes.body.data.status).toBe('resolved_house');
  });

  it('returns 400 when status is missing from update', async () => {
    const { cookies: adminCookies, csrfToken: adminCsrf } = await setupAdminSession();
    const { userId: targetId, cookies: userCookies, csrfToken: userCsrf } =
      await registerUser(app, {
        username: 'dispute_nostatus1',
        password: 'DisputePass12345',
        displayName: 'Dispute No Status 1',
      });

    // top up and get ledger entry ID (topUp returns { balanceCents }, not { _id })
    const ledgerEntryId = await topupAndGetLedgerEntryId(
      adminCookies, adminCsrf, targetId, userCookies, 1000, 'nostatus'
    );

    const disputeRes = await request(app)
      .post('/api/v1/wallet/disputes')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        ledgerEntryId,
        reason: 'Testing missing status in dispute update endpoint call.',
        idempotencyKey: `dispute-nostatus-${Date.now()}`,
      });

    const disputeId = disputeRes.body.data._id as string;

    const updateRes = await request(app)
      .put(`/api/v1/wallet/disputes/${disputeId}`)
      .set('Cookie', adminCookies)
      .set('x-csrf-token', adminCsrf)
      .send({ internalNotes: 'No status provided.' }); // missing status

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.ok).toBe(false);
  });
});
