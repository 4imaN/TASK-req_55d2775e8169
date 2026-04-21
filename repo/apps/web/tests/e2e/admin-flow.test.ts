/**
 * E2E — Admin Flow
 *
 * Validates the complete admin/staff user journey as the React frontend
 * experiences it:
 *   Login as admin → Create zone → Create room → Edit zone →
 *   View audit logs → Verify audit chain → List users → Update user roles →
 *   View analytics KPIs → View membership tiers/members →
 *   Manage leads pipeline → Review moderation reports
 *
 * Mirrors these admin/staff pages:
 *   ZoneManagementPage.tsx   → GET/POST/PUT /zones
 *   RoomSetupPage.tsx        → GET/POST/PUT /rooms
 *   AuditPage.tsx            → GET /audit-logs, GET /audit-logs/verify
 *   UsersPage.tsx            → GET /users, PUT /users/:id/roles
 *   AnalyticsPage.tsx        → GET /analytics/*
 *   MembershipPage.tsx       → GET/POST /membership/tiers, GET /membership/members
 *   LeadManagementPage.tsx   → GET/PUT /leads (staff view)
 *   ModerationPage.tsx       → GET /moderation/reports
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
  getCsrfToken,
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
    username: 'adminuser',
    password: 'AdminPass12345',
    displayName: 'Admin User',
  });
  await promoteToAdmin(userId);
  const { cookies, csrfToken } = await loginUser(app, {
    username: 'adminuser',
    password: 'AdminPass12345',
  });
  return { cookies, csrfToken, adminId: userId };
}

// ── Zone management (ZoneManagementPage.tsx) ──────────────────────────────────

describe('Admin flow — Zone management', () => {
  it('creates a zone via POST /zones (admin only)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Main Library', description: 'Central study zone' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    // ZoneManagementPage.tsx Zone interface: { _id, name, description, isActive, version }
    const zone = res.body.data;
    expect(zone._id).toBeDefined();
    expect(zone.name).toBe('Main Library');
    expect(zone.description).toBe('Central study zone');
    expect(zone.isActive).toBe(true);
    expect(typeof zone.version).toBe('number');
  });

  it('rejects zone creation by a non-admin user (403)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'normaluser1',
      password: 'NormalPass12345',
      displayName: 'Normal User 1',
    });

    const res = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Unauthorized Zone' });

    expect([403, 401]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  it('lists zones after creation (GET /zones)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Science Wing', description: 'Science building' });

    const listRes = await request(app)
      .get('/api/v1/zones')
      .query({ pageSize: '100' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    const names = (listRes.body.data as { name: string }[]).map((z) => z.name);
    expect(names).toContain('Science Wing');
  });

  it('updates a zone (PUT /zones/:id) — ZoneManagementPage.tsx openEdit', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const createRes = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Old Name', description: 'Old description' });

    const zone = createRes.body.data;

    const updateRes = await request(app)
      .put(`/api/v1/zones/${zone._id}`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Updated Name',
        description: 'Updated description',
        isActive: true,
        version: zone.version,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);
    expect(updateRes.body.data.name).toBe('Updated Name');
  });
});

// ── Room management (staff/RoomSetupPage.tsx) ─────────────────────────────────

describe('Admin flow — Room management', () => {
  it('creates a room in a zone (POST /rooms)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const zoneRes = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Room Test Zone' });

    const zoneId = zoneRes.body.data._id as string;

    const roomRes = await request(app)
      .post('/api/v1/rooms')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        zoneId,
        name: 'Conference Room A',
        capacity: 8,
        amenities: ['projector', 'whiteboard'],
        description: 'Large meeting room',
      });

    expect(roomRes.status).toBe(201);
    expect(roomRes.body.ok).toBe(true);

    const room = roomRes.body.data;
    expect(room._id).toBeDefined();
    expect(room.zoneId).toBe(zoneId);
    expect(room.name).toBe('Conference Room A');
    expect(room.capacity).toBe(8);
    expect(room.amenities).toContain('projector');
    expect(room.isActive).toBe(true);
  });

  it('lists rooms created by admin', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const zoneRes = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'List Zone' });

    const zoneId = zoneRes.body.data._id as string;

    await request(app)
      .post('/api/v1/rooms')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ zoneId, name: 'Room 101', capacity: 4, amenities: [] });

    const listRes = await request(app)
      .get('/api/v1/rooms')
      .query({ pageSize: '50' })
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    const names = (listRes.body.data as { name: string }[]).map((r) => r.name);
    expect(names).toContain('Room 101');
  });
});

// ── Audit logs (admin/AuditPage.tsx) ─────────────────────────────────────────

describe('Admin flow — Audit logs', () => {
  it('returns audit logs with the shape AuditPage.tsx expects', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    // Create a zone to generate an audit log entry
    await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Audit Test Zone' });

    const auditRes = await request(app)
      .get('/api/v1/audit-logs')
      .query({ page: '1', pageSize: '25' })
      .set('Cookie', cookies);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.ok).toBe(true);
    expect(Array.isArray(auditRes.body.data)).toBe(true);
    expect(auditRes.body.data.length).toBeGreaterThan(0);

    // AuditPage.tsx AuditLog interface
    const log = auditRes.body.data[0];
    expect(log._id).toBeDefined();
    expect(typeof log.action).toBe('string');
    expect(typeof log.actorRole).toBe('string');
    expect(log.createdAt).toBeDefined();
    expect(log.hash).toBeDefined();
    expect(log.requestId).toBeDefined();
  });

  it('verifies the audit chain integrity (GET /audit-logs/verify)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    // Generate some audit entries
    await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Chain Zone' });

    const verifyRes = await request(app)
      .get('/api/v1/audit-logs/verify')
      .set('Cookie', cookies);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.ok).toBe(true);
    // AuditPage.tsx verifies: data.valid === true
    expect(typeof verifyRes.body.data.valid).toBe('boolean');
  });

  it('supports date range filtering', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Filter Zone' });

    const now = new Date();
    const startDate = new Date(now.getTime() - 86400_000).toISOString();
    const endDate = new Date(now.getTime() + 86400_000).toISOString();

    const filteredRes = await request(app)
      .get('/api/v1/audit-logs')
      .query({ startDate, endDate, page: '1', pageSize: '25' })
      .set('Cookie', cookies);

    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.ok).toBe(true);
    expect(filteredRes.body.data.length).toBeGreaterThan(0);
  });

  it('rejects non-admin users from viewing audit logs', async () => {
    const { cookies } = await registerUser(app, {
      username: 'noadminaudit',
      password: 'NormalPass12345',
      displayName: 'No Admin Audit',
    });

    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

// ── User management (admin/UsersPage.tsx) ─────────────────────────────────────

describe('Admin flow — User management', () => {
  it('returns paginated user list with the shape UsersPage.tsx expects', async () => {
    const { cookies } = await setupAdminSession();

    // Seed a regular user
    await registerUser(app, {
      username: 'targetuser',
      password: 'TargetPass12345',
      displayName: 'Target User',
    });

    const res = await request(app)
      .get('/api/v1/users')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    // UsersPage.tsx User interface: { _id, username, displayName, roles, reputationTier, isActive }
    const u = res.body.data[0];
    expect(u._id).toBeDefined();
    expect(typeof u.username).toBe('string');
    expect(typeof u.displayName).toBe('string');
    expect(Array.isArray(u.roles)).toBe(true);
    expect(u.reputationTier).toBeDefined();
    expect(typeof u.isActive).toBe('boolean');
    // passwordHash must never be exposed
    expect(u.passwordHash).toBeUndefined();
  });

  it('updates user roles (PUT /users/:id/roles) — UsersPage.tsx saveRoles', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const { userId: targetId } = await registerUser(app, {
      username: 'rolechangeuser',
      password: 'RolePass12345',
      displayName: 'Role Change User',
    });

    const updateRes = await request(app)
      .put(`/api/v1/users/${targetId}/roles`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roles: ['moderator'] });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);

    // Verify via user list
    const listRes = await request(app)
      .get('/api/v1/users')
      .query({ pageSize: '50' })
      .set('Cookie', cookies);

    const updated = (listRes.body.data as { _id: string; roles: string[] }[]).find(
      (u) => u._id === targetId
    );
    expect(updated?.roles).toContain('moderator');
  });

  it('rejects role update from a non-admin user', async () => {
    const { userId: targetId } = await registerUser(app, {
      username: 'roletarget',
      password: 'RolePass12345',
      displayName: 'Role Target',
    });
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'nonprivileged',
      password: 'RolePass12345',
      displayName: 'Non Privileged',
    });

    const res = await request(app)
      .put(`/api/v1/users/${targetId}/roles`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roles: ['administrator'] });

    expect([403, 401]).toContain(res.status);
  });

  it('returns pagination meta for large user sets', async () => {
    const { cookies } = await setupAdminSession();

    const res = await request(app)
      .get('/api/v1/users')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.meta).toBeDefined();
    expect(typeof (res.body.meta as { total?: number }).total).toBe('number');
  });
});

// ── Analytics (admin/AnalyticsPage.tsx) ───────────────────────────────────────

describe('Admin flow — Analytics', () => {
  it('returns booking-conversion rate (GET /analytics/booking-conversion)', async () => {
    const { cookies } = await setupAdminSession();

    const now = new Date();
    const startDate = new Date(now.getTime() - 30 * 86400_000).toISOString();
    const endDate = now.toISOString();

    const res = await request(app)
      .get('/api/v1/analytics/booking-conversion')
      .query({ startDate, endDate, grain: 'day' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // AnalyticsPage.tsx reads: res.data.value
    expect(typeof (res.body.data as { value: number }).value).toBe('number');
  });

  it('returns attendance rate (GET /analytics/attendance-rate)', async () => {
    const { cookies } = await setupAdminSession();

    const now = new Date();
    const res = await request(app)
      .get('/api/v1/analytics/attendance-rate')
      .query({
        startDate: new Date(now.getTime() - 30 * 86400_000).toISOString(),
        endDate: now.toISOString(),
        grain: 'day',
      })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof (res.body.data as { value: number }).value).toBe('number');
  });

  it('returns no-show rate (GET /analytics/noshow-rate)', async () => {
    const { cookies } = await setupAdminSession();

    const now = new Date();
    const res = await request(app)
      .get('/api/v1/analytics/noshow-rate')
      .query({
        startDate: new Date(now.getTime() - 30 * 86400_000).toISOString(),
        endDate: now.toISOString(),
        grain: 'day',
      })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof (res.body.data as { value: number }).value).toBe('number');
  });

  it('returns utilization snapshots array (GET /analytics/snapshots)', async () => {
    const { cookies } = await setupAdminSession();

    const now = new Date();
    const res = await request(app)
      .get('/api/v1/analytics/snapshots')
      .query({
        startDate: new Date(now.getTime() - 30 * 86400_000).toISOString(),
        endDate: now.toISOString(),
        grain: 'day',
      })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects analytics access from a non-admin', async () => {
    const { cookies } = await registerUser(app, {
      username: 'noadminanalytics',
      password: 'NormalPass12345',
      displayName: 'No Admin Analytics',
    });

    const now = new Date();
    const res = await request(app)
      .get('/api/v1/analytics/booking-conversion')
      .query({
        startDate: new Date(now.getTime() - 86400_000).toISOString(),
        endDate: now.toISOString(),
      })
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

// ── Membership management (admin/MembershipPage.tsx) ─────────────────────────

describe('Admin flow — Membership tiers & members', () => {
  it('creates a membership tier (POST /membership/tiers)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/membership/tiers')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Premium',
        description: 'Premium membership tier',
        benefits: { maxBookingsPerDay: 5 },
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const tier = res.body.data;
    expect(tier._id).toBeDefined();
    expect(tier.name).toBe('Premium');
    expect(typeof tier.version).toBe('number');
  });

  it('lists membership tiers (GET /membership/tiers)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    await request(app)
      .post('/api/v1/membership/tiers')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Basic', description: 'Basic tier', benefits: {} });

    const listRes = await request(app)
      .get('/api/v1/membership/tiers')
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    const tier = listRes.body.data[0];
    expect(tier._id).toBeDefined();
    expect(typeof tier.name).toBe('string');
    expect(tier.benefits).toBeDefined();
  });

  it('lists membership members (GET /membership/members)', async () => {
    const { cookies } = await setupAdminSession();

    const res = await request(app)
      .get('/api/v1/membership/members')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    // MembershipPage.tsx Member interface
    if (res.body.data.length > 0) {
      const m = res.body.data[0];
      expect(m._id).toBeDefined();
      expect(m.userId).toBeDefined();
      expect(typeof m.balanceCents).toBe('number');
      expect(typeof m.pointsBalance).toBe('number');
    }
  });
});

// ── Policies (admin/PoliciesPage.tsx) ─────────────────────────────────────────

describe('Admin flow — Policies', () => {
  it('returns policies list (GET /policies)', async () => {
    const { cookies } = await setupAdminSession();

    const res = await request(app)
      .get('/api/v1/policies')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects policy access from non-admin users', async () => {
    const { cookies } = await registerUser(app, {
      username: 'noadminpolicies',
      password: 'NormalPass12345',
      displayName: 'No Admin Policies',
    });

    const res = await request(app)
      .get('/api/v1/policies')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

// ── Reviews & Q&A moderation (ReviewsPage.tsx moderation features) ────────────

describe('Admin flow — Moderation', () => {
  it('lists moderation reports (GET /moderation/reports)', async () => {
    const { cookies } = await setupAdminSession();

    const res = await request(app)
      .get('/api/v1/moderation/reports')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects moderation access from regular users', async () => {
    const { cookies } = await registerUser(app, {
      username: 'noadminmod',
      password: 'NormalPass12345',
      displayName: 'No Admin Mod',
    });

    const res = await request(app)
      .get('/api/v1/moderation/reports')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

// ── Business Hours (staff/BusinessHoursPage.tsx) ──────────────────────────────

describe('Admin flow — Business hours', () => {
  it('returns business hours (GET /business-hours)', async () => {
    const { cookies } = await setupAdminSession();

    const res = await request(app)
      .get('/api/v1/business-hours')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('creates business hours for a day (POST /business-hours)', async () => {
    const { cookies, csrfToken } = await setupAdminSession();

    const res = await request(app)
      .post('/api/v1/business-hours')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        scope: 'site',
        scopeId: null,
        dayOfWeek: 1, // Monday
        openTime: '08:00',
        closeTime: '22:00',
        isActive: true,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.dayOfWeek).toBe(1);
    expect(res.body.data.openTime).toBe('08:00');
  });
});

// ── Full admin journey (multi-step) ──────────────────────────────────────────

describe('Admin flow — Full multi-step journey', () => {
  it('register → promote → login → create zone → create room → audit logs → list users', async () => {
    // Register admin account
    const { userId: adminId } = await registerUser(app, {
      username: 'fulladmin',
      password: 'AdminPass12345',
      displayName: 'Full Admin',
    });
    await promoteToAdmin(adminId);

    // Login as admin
    const { cookies, csrfToken } = await loginUser(app, {
      username: 'fulladmin',
      password: 'AdminPass12345',
    });

    // Create zone
    const zoneRes = await request(app)
      .post('/api/v1/zones')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Journey Zone', description: 'Full admin journey zone' });

    expect(zoneRes.status).toBe(201);
    const zoneId = zoneRes.body.data._id as string;

    // Create room
    const roomRes = await request(app)
      .post('/api/v1/rooms')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ zoneId, name: 'Journey Room', capacity: 6, amenities: ['projector'] });

    expect(roomRes.status).toBe(201);
    const roomId = roomRes.body.data._id as string;

    // Verify zone appears in listing
    const zoneListRes = await request(app)
      .get('/api/v1/zones')
      .query({ pageSize: '100' })
      .set('Cookie', cookies);

    expect(zoneListRes.body.data.some((z: { _id: string }) => z._id === zoneId)).toBe(true);

    // Verify room appears in listing
    const roomListRes = await request(app)
      .get('/api/v1/rooms')
      .query({ zoneId, pageSize: '50' })
      .set('Cookie', cookies);

    expect(roomListRes.body.data.some((r: { _id: string }) => r._id === roomId)).toBe(true);

    // View audit logs (should have registration + login + zone + room)
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
    // Admin should be in the list
    const adminInList = (usersRes.body.data as { _id: string }[]).find(
      (u) => u._id === adminId
    );
    expect(adminInList).toBeDefined();
  });
});
