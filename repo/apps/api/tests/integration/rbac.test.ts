import request from 'supertest';
import { setupTestDb, teardownTestDb, getTestApp, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

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

async function registerAndLogin(
  appInstance: express.Application,
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
) {
  const ag = request.agent(appInstance);
  const csrfRes = await ag.get('/api/v1/auth/csrf');
  const csrfToken = csrfRes.body.data.csrfToken;

  const regRes = await ag
    .post('/api/v1/auth/register')
    .set('x-csrf-token', csrfToken)
    .send({ username, password, displayName });

  const cookies = regRes.headers['set-cookie'];
  const userId = regRes.body.data.user._id;

  // If roles needed, directly assign in DB
  if (roles && roles.length > 0) {
    const db = getTestDb();
    const { ObjectId } = await import('mongodb');
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles } }
    );
  }

  // Re-login to get updated roles in session
  if (roles && roles.length > 0) {
    const ag2 = request.agent(appInstance);
    const csrfRes2 = await ag2.get('/api/v1/auth/csrf');
    const csrfToken2 = csrfRes2.body.data.csrfToken;
    const loginRes = await ag2
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken2)
      .send({ username, password });
    return {
      cookies: loginRes.headers['set-cookie'],
      csrfToken: loginRes.body.data.csrfToken,
      userId,
    };
  }

  return { cookies, csrfToken: regRes.body.data.csrfToken, userId };
}

describe('RBAC', () => {
  describe('Zone CRUD permissions', () => {
    it('should allow creator to create zones', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        app, 'creator1', 'CreatorPass1234', 'Creator One', ['creator']
      );

      const res = await request(app)
        .post('/api/v1/zones')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Zone' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Test Zone');
    });

    it('should deny regular user from creating zones', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        app, 'regular1', 'RegularPass1234', 'Regular User'
      );

      const res = await request(app)
        .post('/api/v1/zones')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Zone' });

      expect(res.status).toBe(403);
    });

    it('should allow admin to create zones', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        app, 'admin1', 'AdminPass123456', 'Admin One', ['administrator']
      );

      const res = await request(app)
        .post('/api/v1/zones')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Admin Zone' });

      expect(res.status).toBe(201);
    });

    it('should deny moderator from creating zones', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        app, 'mod1', 'ModeratorPass123', 'Mod One', ['moderator']
      );

      const res = await request(app)
        .post('/api/v1/zones')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Mod Zone' });

      expect(res.status).toBe(403);
    });

    it('should allow any authenticated user to list zones', async () => {
      const { cookies: creatorCookies, csrfToken } = await registerAndLogin(
        app, 'creator2', 'CreatorPass1234', 'Creator Two', ['creator']
      );

      // Create a zone first
      await request(app)
        .post('/api/v1/zones')
        .set('Cookie', creatorCookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Visible Zone' });

      // Regular user should see it
      const { cookies: userCookies } = await registerAndLogin(
        app, 'viewer1', 'ViewerPass12345', 'Viewer One'
      );

      const res = await request(app)
        .get('/api/v1/zones')
        .set('Cookie', userCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Room CRUD permissions', () => {
    it('should allow creator to create rooms', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        app, 'roomcreator', 'CreatorPass1234', 'Room Creator', ['creator']
      );

      // Create zone first
      const zoneRes = await request(app)
        .post('/api/v1/zones')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Room Zone' });

      const zoneId = zoneRes.body.data._id;

      const res = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ zoneId, name: 'Room 101', capacity: 5 });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Room 101');
    });

    it('should deny regular user from creating rooms', async () => {
      const { cookies: creatorCookies, csrfToken: creatorCsrf } = await registerAndLogin(
        app, 'roomcreator2', 'CreatorPass1234', 'Room Creator 2', ['creator']
      );

      const zoneRes = await request(app)
        .post('/api/v1/zones')
        .set('Cookie', creatorCookies)
        .set('x-csrf-token', creatorCsrf)
        .send({ name: 'Another Zone' });

      const zoneId = zoneRes.body.data._id;

      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        app, 'regular2', 'RegularPass1234', 'Regular Two'
      );

      const res = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ zoneId, name: 'Sneaky Room' });

      expect(res.status).toBe(403);
    });
  });

  describe('Admin-only routes', () => {
    it('should deny non-admin access to audit logs', async () => {
      const { cookies } = await registerAndLogin(
        app, 'regular3', 'RegularPass1234', 'Regular Three'
      );

      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
    });

    it('should allow admin access to audit logs', async () => {
      const { cookies } = await registerAndLogin(
        app, 'admin2', 'AdminPass123456', 'Admin Two', ['administrator']
      );

      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
    });
  });
});
