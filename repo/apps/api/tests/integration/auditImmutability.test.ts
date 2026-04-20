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

describe('Audit log immutability', () => {
  it('getAppendOnlyCollection blocks updateOne on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    // Insert is allowed
    await col.insertOne({
      actorUserId: 'test-user',
      action: 'test.action',
      hash: 'abc123',
      createdAt: new Date(),
    } as any);

    // updateOne must throw synchronously
    expect(() =>
      (col as any).updateOne({ actorUserId: 'test-user' }, { $set: { action: 'tampered' } })
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection blocks updateMany on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    expect(() =>
      (col as any).updateMany({}, { $set: { action: 'tampered' } })
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection blocks deleteOne on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    expect(() =>
      (col as any).deleteOne({ actorUserId: 'test-user' })
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection blocks deleteMany on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    expect(() =>
      (col as any).deleteMany({})
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection blocks findOneAndUpdate on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    expect(() =>
      (col as any).findOneAndUpdate({ actorUserId: 'test' }, { $set: { action: 'tampered' } })
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection blocks findOneAndDelete on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    expect(() =>
      (col as any).findOneAndDelete({ actorUserId: 'test' })
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection blocks drop on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    expect(() =>
      (col as any).drop()
    ).toThrow(/Immutability violation/);
  });

  it('getAppendOnlyCollection allows insertOne on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    const result = await col.insertOne({
      actorUserId: 'test-user',
      action: 'test.insert',
      hash: 'def456',
      createdAt: new Date(),
    } as any);

    expect(result.insertedId).toBeDefined();
  });

  it('getAppendOnlyCollection allows find on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    await col.insertOne({
      actorUserId: 'test-user',
      action: 'test.read',
      hash: 'ghi789',
      createdAt: new Date(),
    } as any);

    const docs = await col.find({ actorUserId: 'test-user' }).toArray();
    expect(docs.length).toBe(1);
    expect(docs[0].action).toBe('test.read');
  });

  it('getAppendOnlyCollection allows countDocuments on audit_logs', async () => {
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');

    await col.insertOne({
      actorUserId: 'count-test',
      action: 'test.count',
      hash: 'jkl012',
      createdAt: new Date(),
    } as any);

    const count = await col.countDocuments({ actorUserId: 'count-test' });
    expect(count).toBe(1);
  });

  it('writeAuditLog inserts entries through the append-only guard', async () => {
    const { writeAuditLog } = await import('../../src/services/audit.service');

    await writeAuditLog({
      actorUserId: 'user1',
      actorRole: 'administrator',
      action: 'test.immutability',
      objectType: 'test',
      objectId: 'obj1',
      requestId: 'req-123',
    });

    await writeAuditLog({
      actorUserId: 'user1',
      actorRole: 'administrator',
      action: 'test.immutability2',
      objectType: 'test',
      objectId: 'obj2',
      requestId: 'req-456',
    });

    // Verify entries were persisted with hash chain fields
    const { getAppendOnlyCollection } = await import('../../src/config/db');
    const col = getAppendOnlyCollection('audit_logs');
    const entries = await col.find({}).sort({ createdAt: 1 }).toArray() as any[];
    expect(entries.length).toBe(2);

    // First entry has no previousHash, second chains to first
    expect(entries[0].hash).toBeDefined();
    expect(entries[1].hash).toBeDefined();
    expect(entries[1].previousHash).toBe(entries[0].hash);

    // Verify the guard still blocks mutations on these stored entries
    expect(() =>
      (col as any).deleteMany({})
    ).toThrow(/Immutability violation/);
  });
});
