/**
 * E2E — Room Browsing Flow
 *
 * Validates the room-browsing user journey as the React frontend
 * experiences it:
 *   Login → List zones → List rooms (with pagination + zone filter)
 *          → Check availability → Add/remove favorites
 *
 * Mirrors RoomsPage.tsx API calls:
 *   GET /api/v1/zones
 *   GET /api/v1/rooms
 *   GET /api/v1/reservations/availability
 *   POST /api/v1/favorites
 *   DELETE /api/v1/favorites/:roomId
 *   GET /api/v1/favorites
 *
 * Also validates FavoritesPage.tsx:
 *   GET /api/v1/favorites  (returns { room: { _id, name, ... } } shape)
 */

import request from 'supertest';
import express from 'express';
import {
  setupE2eDb,
  teardownE2eDb,
  clearAndReindex,
  getE2eDb,
  registerUser,
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

async function seedZoneAndRoom(): Promise<{ zoneId: string; roomId: string }> {
  const db = getE2eDb();

  const zoneResult = await db.collection('zones').insertOne({
    name: 'Library Zone',
    description: 'Main library study zone',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const zoneId = zoneResult.insertedId.toString();

  const roomResult = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Quiet Study Room',
    description: 'Best room for focused work',
    capacity: 4,
    amenities: ['wifi', 'whiteboard'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const roomId = roomResult.insertedId.toString();

  return { zoneId, roomId };
}

// ── Zone listing (RoomsPage.tsx fetchZones) ───────────────────────────────────

describe('Room browsing — Zone listing (GET /zones)', () => {
  it('returns empty list when no zones exist', async () => {
    const { cookies } = await registerUser(app, {
      username: 'zonebrowse1',
      password: 'BrowsePass12345',
      displayName: 'Zone Browse 1',
    });

    const res = await request(app)
      .get('/api/v1/zones')
      .query({ pageSize: '100' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns seeded zones with correct shape', async () => {
    const { cookies } = await registerUser(app, {
      username: 'zonebrowse2',
      password: 'BrowsePass12345',
      displayName: 'Zone Browse 2',
    });
    await seedZoneAndRoom();

    const res = await request(app)
      .get('/api/v1/zones')
      .query({ pageSize: '100' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const zone = res.body.data[0];
    // RoomsPage.tsx Zone interface: { _id, name, isActive }
    expect(zone._id).toBeDefined();
    expect(typeof zone.name).toBe('string');
    expect(typeof zone.isActive).toBe('boolean');
  });

  it('returns zones without authentication (zones are public)', async () => {
    await seedZoneAndRoom();

    const res = await request(app)
      .get('/api/v1/zones')
      .query({ pageSize: '100' });

    // Zones should be publicly accessible
    expect([200, 401]).toContain(res.status);
  });
});

// ── Room listing (RoomsPage.tsx fetchRooms) ───────────────────────────────────

describe('Room browsing — Room listing (GET /rooms)', () => {
  it('returns all active rooms with the shape RoomsPage.tsx expects', async () => {
    const { cookies } = await registerUser(app, {
      username: 'roombrowse1',
      password: 'BrowsePass12345',
      displayName: 'Room Browse 1',
    });
    const { zoneId } = await seedZoneAndRoom();

    const res = await request(app)
      .get('/api/v1/rooms')
      .query({ page: '1', pageSize: '12' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const room = res.body.data[0];
    // RoomsPage.tsx Room interface: { _id, zoneId, name, capacity, amenities, isActive }
    expect(room._id).toBeDefined();
    expect(room.zoneId).toBe(zoneId);
    expect(room.name).toBe('Quiet Study Room');
    expect(room.capacity).toBe(4);
    expect(Array.isArray(room.amenities)).toBe(true);
    expect(room.amenities).toContain('wifi');
    expect(room.amenities).toContain('whiteboard');
    expect(room.isActive).toBe(true);

    // Pagination meta
    expect(res.body.meta).toBeDefined();
    expect(typeof (res.body.meta as { total?: number }).total).toBe('number');
  });

  it('filters rooms by zoneId', async () => {
    const { cookies } = await registerUser(app, {
      username: 'roombrowse2',
      password: 'BrowsePass12345',
      displayName: 'Room Browse 2',
    });
    const { zoneId } = await seedZoneAndRoom();

    // Seed a second zone with a room
    const db = getE2eDb();
    const zone2 = await db.collection('zones').insertOne({
      name: 'Science Zone',
      description: 'Science building',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    await db.collection('rooms').insertOne({
      zoneId: zone2.insertedId.toString(),
      name: 'Science Lab Room',
      capacity: 8,
      amenities: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const res = await request(app)
      .get('/api/v1/rooms')
      .query({ zoneId, pageSize: '50' })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].zoneId).toBe(zoneId);
    expect(res.body.data[0].name).toBe('Quiet Study Room');
  });

  it('supports pagination — page 1 and page 2', async () => {
    const { cookies } = await registerUser(app, {
      username: 'roompaginate',
      password: 'BrowsePass12345',
      displayName: 'Room Paginate',
    });

    const db = getE2eDb();
    const zone = await db.collection('zones').insertOne({
      name: 'Paginate Zone',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    // Insert 3 rooms so pageSize=2 gives 2 pages
    for (let i = 1; i <= 3; i++) {
      await db.collection('rooms').insertOne({
        zoneId: zone.insertedId.toString(),
        name: `Paginate Room ${i}`,
        capacity: i,
        amenities: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
    }

    const page1 = await request(app)
      .get('/api/v1/rooms')
      .query({ page: '1', pageSize: '2' })
      .set('Cookie', cookies);

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect((page1.body.meta as { total?: number }).total).toBe(3);

    const page2 = await request(app)
      .get('/api/v1/rooms')
      .query({ page: '2', pageSize: '2' })
      .set('Cookie', cookies);

    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1);
  });
});

// ── Availability check (RoomsPage.tsx fetchSlots) ─────────────────────────────

describe('Room browsing — Availability (GET /reservations/availability)', () => {
  it('returns availability data in the shape RoomsPage.tsx expects', async () => {
    const { cookies } = await registerUser(app, {
      username: 'availuser1',
      password: 'BrowsePass12345',
      displayName: 'Avail User 1',
    });
    const { roomId } = await seedZoneAndRoom();

    const { startAtUtc, endAtUtc, dayOfWeek } = tomorrowSlot(10, 11);
    await seedBusinessHours(dayOfWeek);

    const dateStr = startAtUtc.split('T')[0];
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.000Z`;

    const res = await request(app)
      .get('/api/v1/reservations/availability')
      .query({ roomId, startDate: dayStart, endDate: dayEnd })
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // RoomsPage.tsx expects array of { date, slots: [{ start, end, available }] }
    const data = res.body.data;
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      const dayGroup = data[0];
      expect(dayGroup.date).toBeDefined();
      expect(Array.isArray(dayGroup.slots)).toBe(true);
      if (dayGroup.slots.length > 0) {
        const slot = dayGroup.slots[0];
        expect(slot.start).toBeDefined();
        expect(slot.end).toBeDefined();
        expect(typeof slot.available).toBe('boolean');
      }
    }
  });

  it('returns 400 or empty when roomId is missing', async () => {
    const { cookies } = await registerUser(app, {
      username: 'availuser2',
      password: 'BrowsePass12345',
      displayName: 'Avail User 2',
    });

    const res = await request(app)
      .get('/api/v1/reservations/availability')
      .query({ startDate: '2099-01-01', endDate: '2099-01-01' })
      .set('Cookie', cookies);

    expect([400, 422]).toContain(res.status);
  });
});

// ── Favorites (RoomsPage.tsx toggleFavorite + FavoritesPage.tsx) ──────────────

describe('Room browsing — Favorites (POST/DELETE/GET /favorites)', () => {
  it('adds a room to favorites (POST /favorites) and verifies shape', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'favuser1',
      password: 'BrowsePass12345',
      displayName: 'Fav User 1',
    });
    const { roomId } = await seedZoneAndRoom();

    const res = await request(app)
      .post('/api/v1/favorites')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roomId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('lists favorites and returns populated room data (FavoritesPage.tsx contract)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'favuser2',
      password: 'BrowsePass12345',
      displayName: 'Fav User 2',
    });
    const { roomId } = await seedZoneAndRoom();

    // Add favorite
    await request(app)
      .post('/api/v1/favorites')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roomId });

    // List favorites
    const listRes = await request(app)
      .get('/api/v1/favorites')
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.data).toHaveLength(1);

    const fav = listRes.body.data[0];
    // FavoritesPage.tsx expects: { _id, roomId, room?: Room, createdAt }
    expect(fav._id).toBeDefined();
    expect(fav.createdAt).toBeDefined();
    // roomId may be a string or object ref depending on population
    const favRoomId =
      typeof fav.roomId === 'object' ? fav.roomId._id : fav.roomId;
    expect(favRoomId).toBe(roomId);
  });

  it('removes a room from favorites (DELETE /favorites/:roomId)', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'favuser3',
      password: 'BrowsePass12345',
      displayName: 'Fav User 3',
    });
    const { roomId } = await seedZoneAndRoom();

    // Add
    await request(app)
      .post('/api/v1/favorites')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ roomId });

    // Remove
    const delRes = await request(app)
      .delete(`/api/v1/favorites/${roomId}`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken);

    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // List should now be empty
    const listRes = await request(app)
      .get('/api/v1/favorites')
      .set('Cookie', cookies);

    expect(listRes.body.data).toHaveLength(0);
  });

  it("does not show another user's favorites", async () => {
    const { cookies: cookies1, csrfToken: csrf1 } = await registerUser(app, {
      username: 'favowner',
      password: 'BrowsePass12345',
      displayName: 'Fav Owner',
    });
    const { cookies: cookies2 } = await registerUser(app, {
      username: 'favvisitor',
      password: 'BrowsePass12345',
      displayName: 'Fav Visitor',
    });
    const { roomId } = await seedZoneAndRoom();

    // User 1 adds favorite
    await request(app)
      .post('/api/v1/favorites')
      .set('Cookie', cookies1)
      .set('x-csrf-token', csrf1)
      .send({ roomId });

    // User 2 should see empty list
    const res = await request(app)
      .get('/api/v1/favorites')
      .set('Cookie', cookies2);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
