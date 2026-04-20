import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestDb } from '../setup';
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

describe('Notification TTL index', () => {
  it('has a TTL index on notifications.expiresAt', async () => {
    const db = getTestDb();
    const indexes = await db.collection('notifications').indexes();

    const ttlIndex = indexes.find(
      (idx: any) => idx.name === 'idx_notifications_ttl'
    );
    expect(ttlIndex).toBeTruthy();
    expect(ttlIndex!.key).toEqual({ expiresAt: 1 });
    expect(ttlIndex!.expireAfterSeconds).toBe(0);
  });

  it('still has the query index for user/read/due', async () => {
    const db = getTestDb();
    const indexes = await db.collection('notifications').indexes();

    const queryIndex = indexes.find(
      (idx: any) => idx.name === 'idx_notifications_user_read_due'
    );
    expect(queryIndex).toBeTruthy();
    expect(queryIndex!.key).toEqual({ userId: 1, readAt: 1, dueAt: -1 });
  });

  it('face_events also has its own TTL index (pre-existing)', async () => {
    const db = getTestDb();
    const indexes = await db.collection('face_events').indexes();

    const ttlIndex = indexes.find(
      (idx: any) => idx.name === 'idx_face_events_ttl'
    );
    expect(ttlIndex).toBeTruthy();
    expect(ttlIndex!.expireAfterSeconds).toBe(0);
  });
});

describe('Notification retention job as secondary cleanup', () => {
  it('purgeExpiredNotifications deletes read notifications older than 90 days', async () => {
    const db = getTestDb();
    const col = db.collection('notifications');

    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    // Old read notification — should be purged
    await col.insertOne({
      userId: 'user1',
      type: 'info',
      title: 'Old notification',
      message: 'This is old',
      readAt: oldDate,
      expiresAt: oldDate,
      createdAt: oldDate,
    });

    // Recent read notification — should NOT be purged
    await col.insertOne({
      userId: 'user1',
      type: 'info',
      title: 'Recent notification',
      message: 'This is recent',
      readAt: recentDate,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      createdAt: recentDate,
    });

    const { purgeExpiredNotifications } = await import('../../src/jobs/retentionJobs');
    const purged = await purgeExpiredNotifications();

    expect(purged).toBe(1);
    const remaining = await col.countDocuments({});
    expect(remaining).toBe(1);
  });
});
