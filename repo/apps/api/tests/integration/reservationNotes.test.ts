import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function agent() {
  return request.agent(app);
}

async function getCsrf(ag: ReturnType<typeof request.agent>): Promise<string> {
  const res = await ag.get('/api/v1/auth/csrf');
  return res.body.data.csrfToken as string;
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ agent: ReturnType<typeof request.agent>; userId: string }> {
  const ag = agent();

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

  return { agent: ag, userId };
}

async function createTestRoom(): Promise<{ zoneId: string; roomId: string }> {
  const db = getTestDb();
  const zoneRes = await db.collection('zones').insertOne({
    name: 'Notes Test Zone',
    description: 'Zone for notes tests',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const zoneId = zoneRes.insertedId.toString();

  const roomRes = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Notes Test Room',
    description: 'A room for notes testing',
    capacity: 4,
    amenities: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const roomId = roomRes.insertedId.toString();

  for (let day = 0; day <= 6; day++) {
    await db.collection('business_hours').insertOne({
      scope: 'site',
      scopeId: null,
      dayOfWeek: day,
      openTime: '00:00',
      closeTime: '23:59',
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return { zoneId, roomId };
}

function futureAligned(offsetHours = 24, durationMinutes = 60): { start: string; end: string } {
  const ms = Date.now();
  const aligned = Math.ceil(ms / (15 * 60 * 1000)) * 15 * 60 * 1000;
  const start = new Date(aligned + offsetHours * 60 * 60 * 1000);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

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

describe('Reservation notes', () => {
  it('persists notes when creating a reservation', async () => {
    const { agent: ag } = await registerAndLogin(
      'notesuser1', 'NotesPass1234!', 'Notes User'
    );
    const { roomId } = await createTestRoom();
    const { start, end } = futureAligned(24, 60);

    const csrf = await getCsrf(ag);
    const res = await ag
      .post('/api/v1/reservations')
      .set('x-csrf-token', csrf)
      .send({
        roomId,
        startAtUtc: start,
        endAtUtc: end,
        idempotencyKey: 'idem-notes-1',
        notes: 'Please prepare a whiteboard marker',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.notes).toBe('Please prepare a whiteboard marker');

    // Verify it's persisted in the DB
    const db = getTestDb();
    const saved = await db.collection('reservations').findOne({
      _id: new ObjectId(res.body.data._id),
    });
    expect(saved).toBeTruthy();
    expect(saved!.notes).toBe('Please prepare a whiteboard marker');
  });

  it('creates reservation without notes when not provided', async () => {
    const { agent: ag } = await registerAndLogin(
      'notesuser2', 'NotesPass1234!', 'Notes User 2'
    );
    const { roomId } = await createTestRoom();
    const { start, end } = futureAligned(48, 60);

    const csrf = await getCsrf(ag);
    const res = await ag
      .post('/api/v1/reservations')
      .set('x-csrf-token', csrf)
      .send({
        roomId,
        startAtUtc: start,
        endAtUtc: end,
        idempotencyKey: 'idem-notes-2',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.notes).toBeUndefined();
  });

  it('returns notes when fetching a reservation', async () => {
    const { agent: ag } = await registerAndLogin(
      'notesuser3', 'NotesPass1234!', 'Notes User 3'
    );
    const { roomId } = await createTestRoom();
    const { start, end } = futureAligned(72, 60);

    let csrf = await getCsrf(ag);
    const createRes = await ag
      .post('/api/v1/reservations')
      .set('x-csrf-token', csrf)
      .send({
        roomId,
        startAtUtc: start,
        endAtUtc: end,
        idempotencyKey: 'idem-notes-3',
        notes: 'Group of 4, need extra chairs',
      });
    expect(createRes.status).toBe(201);
    const reservationId = createRes.body.data._id;

    // Fetch the reservation
    const getRes = await ag
      .get(`/api/v1/reservations/${reservationId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.notes).toBe('Group of 4, need extra chairs');
  });
});
