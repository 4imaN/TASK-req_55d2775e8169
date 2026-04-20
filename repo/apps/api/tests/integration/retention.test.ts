import request from 'supertest';
import { ObjectId } from 'mongodb';
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

describe('Session retention cleanup', () => {
  it('purges expired_idle sessions older than 30 days', async () => {
    const db = getTestDb();
    const sessionsCol = db.collection('sessions');
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    // Insert a terminal session with updatedAt older than 30 days
    await sessionsCol.insertOne({
      userId: new ObjectId().toString(),
      createdAt: oldDate,
      lastActivityAt: oldDate,
      expiresAt: oldDate,
      absoluteExpiresAt: oldDate,
      revokedAt: null,
      status: 'expired_idle',
      updatedAt: oldDate,
    });

    // Insert a recent terminal session that should NOT be purged
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await sessionsCol.insertOne({
      userId: new ObjectId().toString(),
      createdAt: recentDate,
      lastActivityAt: recentDate,
      expiresAt: recentDate,
      absoluteExpiresAt: recentDate,
      revokedAt: null,
      status: 'expired_idle',
      updatedAt: recentDate,
    });

    const { purgeExpiredSessions } = await import('../../src/jobs/retentionJobs');
    const purged = await purgeExpiredSessions();

    expect(purged).toBe(1);
    const remaining = await sessionsCol.countDocuments({});
    expect(remaining).toBe(1);
  });

  it('purges expired_absolute sessions older than 30 days', async () => {
    const db = getTestDb();
    const sessionsCol = db.collection('sessions');
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await sessionsCol.insertOne({
      userId: new ObjectId().toString(),
      createdAt: oldDate,
      lastActivityAt: oldDate,
      expiresAt: oldDate,
      absoluteExpiresAt: oldDate,
      revokedAt: null,
      status: 'expired_absolute',
      updatedAt: oldDate,
    });

    const { purgeExpiredSessions } = await import('../../src/jobs/retentionJobs');
    const purged = await purgeExpiredSessions();

    expect(purged).toBe(1);
  });

  it('purges revoked sessions older than 30 days', async () => {
    const db = getTestDb();
    const sessionsCol = db.collection('sessions');
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await sessionsCol.insertOne({
      userId: new ObjectId().toString(),
      createdAt: oldDate,
      lastActivityAt: oldDate,
      expiresAt: oldDate,
      absoluteExpiresAt: oldDate,
      revokedAt: oldDate,
      status: 'revoked',
      updatedAt: oldDate,
    });

    const { purgeExpiredSessions } = await import('../../src/jobs/retentionJobs');
    const purged = await purgeExpiredSessions();

    expect(purged).toBe(1);
  });

  it('does not purge active sessions', async () => {
    const db = getTestDb();
    const sessionsCol = db.collection('sessions');
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await sessionsCol.insertOne({
      userId: new ObjectId().toString(),
      createdAt: oldDate,
      lastActivityAt: oldDate,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      revokedAt: null,
      status: 'active',
      updatedAt: oldDate,
    });

    const { purgeExpiredSessions } = await import('../../src/jobs/retentionJobs');
    const purged = await purgeExpiredSessions();

    expect(purged).toBe(0);
  });
});
