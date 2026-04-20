import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function createAgent() {
  return request.agent(app);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

describe('Users API', () => {
  describe('GET /api/v1/users/me', () => {
    it('returns the authenticated user', async () => {
      const { cookies } = await registerAndLogin('meuser1', 'MePass12345!', 'Me User');

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.username).toBe('meuser1');
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('returns a user when called by an admin', async () => {
      const { userId } = await registerAndLogin('targetuser1', 'TargetPass1234!', 'Target User');
      const { cookies: adminCookies } = await registerAndLogin(
        'adminuser1', 'AdminPass1234!', 'Admin User', ['administrator']
      );

      const res = await request(app)
        .get(`/api/v1/users/${userId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(userId);
      expect(res.body.data.username).toBe('targetuser1');
    });

    it('returns 403 when called by a non-admin', async () => {
      const { userId } = await registerAndLogin('targetuser2', 'TargetPass1234!', 'Target User 2');
      const { cookies } = await registerAndLogin('regularuser1', 'RegPass1234!', 'Regular User');

      const res = await request(app)
        .get(`/api/v1/users/${userId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/users', () => {
    it('lists users for admin', async () => {
      await registerAndLogin('listuser1', 'ListPass1234!', 'List User 1');
      await registerAndLogin('listuser2', 'ListPass1234!', 'List User 2');
      const { cookies: adminCookies } = await registerAndLogin(
        'listadmin1', 'AdminPass1234!', 'List Admin', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/users')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    });

    it('returns 403 for non-admin', async () => {
      const { cookies } = await registerAndLogin('regularlist1', 'RegPass1234!', 'Regular List');

      const res = await request(app)
        .get('/api/v1/users')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/users/:id/roles', () => {
    it('replaces roles atomically', async () => {
      const { userId } = await registerAndLogin('roleuser1', 'RolePass1234!', 'Role User');
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'roleadmin1', 'AdminPass1234!', 'Role Admin', ['administrator']
      );

      const res = await request(app)
        .put(`/api/v1/users/${userId}/roles`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ roles: ['creator', 'moderator'] });

      expect(res.status).toBe(200);
      expect(res.body.data.roles).toEqual(expect.arrayContaining(['creator', 'moderator']));

      const db = getTestDb();
      const user = await db.collection('users').findOne({ _id: new ObjectId(userId) }) as any;
      expect(user.roles).toEqual(expect.arrayContaining(['creator', 'moderator']));
    });

    it('rejects invalid role names', async () => {
      const { userId } = await registerAndLogin('roleuser2', 'RolePass1234!', 'Role User 2');
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'roleadmin2', 'AdminPass1234!', 'Role Admin 2', ['administrator']
      );

      const res = await request(app)
        .put(`/api/v1/users/${userId}/roles`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ roles: ['superadmin'] });

      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/users/:id/roles', () => {
    it('adds a single role', async () => {
      const { userId } = await registerAndLogin('addroleuser1', 'RolePass1234!', 'Add Role User');
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'addroleadmin1', 'AdminPass1234!', 'Add Role Admin', ['administrator']
      );

      const res = await request(app)
        .post(`/api/v1/users/${userId}/roles`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf)
        .send({ role: 'creator' });

      expect(res.status).toBe(200);
      expect(res.body.data.assigned).toBe(true);
    });
  });

  describe('DELETE /api/v1/users/:id/roles/:role', () => {
    it('removes a role', async () => {
      const { userId } = await registerAndLogin('delroleuser1', 'RolePass1234!', 'Del Role User');
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'delroleadmin1', 'AdminPass1234!', 'Del Role Admin', ['administrator']
      );

      // Assign a role first
      const db = getTestDb();
      await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: { roles: ['creator'] } }
      );

      const res = await request(app)
        .delete(`/api/v1/users/${userId}/roles/creator`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf);

      expect(res.status).toBe(200);
      expect(res.body.data.removed).toBe(true);
    });
  });

  describe('POST /api/v1/users/:id/unlock', () => {
    it('unlocks a locked user', async () => {
      const { userId } = await registerAndLogin('lockuser1', 'LockPass1234!', 'Lock User');
      const { cookies: adminCookies, csrfToken: adminCsrf } = await registerAndLogin(
        'lockadmin1', 'AdminPass1234!', 'Lock Admin', ['administrator']
      );

      // Lock the user directly
      const db = getTestDb();
      await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: { isLocked: true, failedLoginAttempts: 5 } }
      );

      const res = await request(app)
        .post(`/api/v1/users/${userId}/unlock`)
        .set('Cookie', adminCookies)
        .set('x-csrf-token', adminCsrf);

      expect(res.status).toBe(200);
      expect(res.body.data.unlocked).toBe(true);
    });
  });
});
