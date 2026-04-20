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

async function createZone(cookies: string[], csrfToken: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/zones')
    .set('Cookie', cookies)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Test Zone' });
  expect(res.status).toBe(201);
  return res.body.data._id as string;
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

describe('Rooms API', () => {
  describe('GET /api/v1/rooms', () => {
    it('returns paginated rooms list', async () => {
      const db = getTestDb();
      const zoneRes = await db.collection('zones').insertOne({
        name: 'Zone A',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
      const zoneId = zoneRes.insertedId.toString();

      await db.collection('rooms').insertOne({
        zoneId,
        name: 'Room 101',
        capacity: 4,
        amenities: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const { cookies } = await registerAndLogin('roomlist1', 'ListPass1234!', 'Room Lister');

      const res = await request(app)
        .get('/api/v1/rooms')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/rooms');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/rooms/:id', () => {
    it('returns a single room by id', async () => {
      const db = getTestDb();
      const zoneRes = await db.collection('zones').insertOne({
        name: 'Zone B',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
      const roomRes = await db.collection('rooms').insertOne({
        zoneId: zoneRes.insertedId.toString(),
        name: 'Room 202',
        capacity: 6,
        amenities: ['whiteboard'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
      const roomId = roomRes.insertedId.toString();

      const { cookies } = await registerAndLogin('roomget1', 'GetPass1234!', 'Room Getter');

      const res = await request(app)
        .get(`/api/v1/rooms/${roomId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Room 202');
      expect(res.body.data._id).toBe(roomId);
    });

    it('returns 404 for non-existent room', async () => {
      const { cookies } = await registerAndLogin('roomget2', 'GetPass1234!', 'Room Getter 2');
      const fakeId = new ObjectId().toString();

      const res = await request(app)
        .get(`/api/v1/rooms/${fakeId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/rooms', () => {
    it('allows creator to create a room', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'roomcreator1', 'CreatePass1234!', 'Room Creator', ['creator']
      );
      const zoneId = await createZone(cookies, csrfToken);

      const res = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ zoneId, name: 'New Room', capacity: 8, amenities: ['projector'] });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.name).toBe('New Room');
      expect(res.body.data.zoneId).toBe(zoneId);
    });

    it('rejects room creation by regular user with 403', async () => {
      const { cookies: creatorCookies, csrfToken: creatorCsrf } = await registerAndLogin(
        'roomcreator2', 'CreatePass1234!', 'Room Creator 2', ['creator']
      );
      const zoneId = await createZone(creatorCookies, creatorCsrf);

      const { cookies: userCookies, csrfToken: userCsrf } = await registerAndLogin(
        'regularroom1', 'RegPass1234!', 'Regular Room User'
      );

      const res = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ zoneId, name: 'Unauthorized Room' });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/rooms/:id', () => {
    it('updates room with correct version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'roomupdater1', 'UpdatePass1234!', 'Room Updater', ['creator']
      );
      const zoneId = await createZone(cookies, csrfToken);

      const createRes = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ zoneId, name: 'Original Room', capacity: 4 });

      expect(createRes.status).toBe(201);
      const roomId = createRes.body.data._id as string;
      const version = createRes.body.data.version as number;

      const updateRes = await request(app)
        .put(`/api/v1/rooms/${roomId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Updated Room', version });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Updated Room');
    });

    it('rejects update with stale version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'roomupdater2', 'UpdatePass1234!', 'Room Updater 2', ['creator']
      );
      const zoneId = await createZone(cookies, csrfToken);

      const createRes = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ zoneId, name: 'Stale Room', capacity: 4 });

      expect(createRes.status).toBe(201);
      const roomId = createRes.body.data._id as string;

      const updateRes = await request(app)
        .put(`/api/v1/rooms/${roomId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Conflict Room', version: 999 });

      expect([409, 422]).toContain(updateRes.status);
    });

    it('rejects update without version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'roomupdater3', 'UpdatePass1234!', 'Room Updater 3', ['creator']
      );
      const zoneId = await createZone(cookies, csrfToken);

      const createRes = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ zoneId, name: 'No Version Room', capacity: 4 });

      expect(createRes.status).toBe(201);
      const roomId = createRes.body.data._id as string;

      const updateRes = await request(app)
        .put(`/api/v1/rooms/${roomId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Missing Version' });

      expect(updateRes.status).toBe(422);
    });
  });
});

describe('Zones API', () => {
  describe('GET /api/v1/zones/:id', () => {
    it('returns a single zone by id', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'zonegetter1', 'ZonePass1234!', 'Zone Getter', ['creator']
      );

      const zoneId = await createZone(cookies, csrfToken);

      const res = await request(app)
        .get(`/api/v1/zones/${zoneId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data._id).toBe(zoneId);
      expect(res.body.data.name).toBe('Test Zone');
    });

    it('returns 404 for non-existent zone', async () => {
      const { cookies } = await registerAndLogin(
        'zonegetter2', 'ZonePass1234!', 'Zone Getter 2', ['creator']
      );
      const fakeId = new ObjectId().toString();

      const res = await request(app)
        .get(`/api/v1/zones/${fakeId}`)
        .set('Cookie', cookies);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/zones/:id', () => {
    it('updates zone with correct version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'zoneupdater1', 'ZonePass1234!', 'Zone Updater', ['creator']
      );

      const zoneId = await createZone(cookies, csrfToken);

      // Fetch the zone to get its current version
      const getRes = await request(app)
        .get(`/api/v1/zones/${zoneId}`)
        .set('Cookie', cookies);
      expect(getRes.status).toBe(200);
      const version = getRes.body.data.version as number;

      const updateRes = await request(app)
        .put(`/api/v1/zones/${zoneId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Updated Zone Name', version });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.ok).toBe(true);
      expect(updateRes.body.data.name).toBe('Updated Zone Name');
    });

    it('rejects update without version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'zoneupdater2', 'ZonePass1234!', 'Zone Updater 2', ['creator']
      );

      const zoneId = await createZone(cookies, csrfToken);

      const updateRes = await request(app)
        .put(`/api/v1/zones/${zoneId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'No Version Zone' });

      expect(updateRes.status).toBe(422);
    });

    it('rejects update with stale version', async () => {
      const { cookies, csrfToken } = await registerAndLogin(
        'zoneupdater3', 'ZonePass1234!', 'Zone Updater 3', ['creator']
      );

      const zoneId = await createZone(cookies, csrfToken);

      const updateRes = await request(app)
        .put(`/api/v1/zones/${zoneId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Stale Zone', version: 999 });

      expect([409, 422]).toContain(updateRes.status);
    });
  });
});
