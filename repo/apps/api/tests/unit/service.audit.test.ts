/**
 * Unit tests for services/audit.service.ts
 *
 * Tests cover:
 *   - writeAuditLog: inserts entry with correct hash chaining
 *   - writeAuditLog: sanitizes sensitive fields before hashing
 *   - verifyAuditChain: valid chain passes
 *   - verifyAuditChain: detects broken previousHash link
 *   - verifyAuditChain: detects tampered hash
 *   - verifyAuditChain: empty log is valid
 */

import './setup';

// ── mock DB ────────────────────────────────────────────────────────────────────

const mockFindOne = jest.fn();
const mockInsertOne = jest.fn();
const mockFind = jest.fn();

jest.mock('../../src/config/db', () => ({
  getAppendOnlyCollection: () => ({
    findOne: mockFindOne,
    insertOne: mockInsertOne,
    find: mockFind,
  }),
  getCollection: jest.fn(),
}));

import { writeAuditLog, verifyAuditChain } from '../../src/services/audit.service';
import { computeAuditHash } from '../../src/utils/crypto';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeBaseEntry(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: 'user-1',
    actorRole: 'administrator',
    action: 'test.action',
    objectType: 'test_object',
    objectId: 'obj-1',
    requestId: 'req-1',
    ...overrides,
  };
}

// ── writeAuditLog ─────────────────────────────────────────────────────────────

describe('writeAuditLog()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertOne.mockResolvedValue({ insertedId: 'some-id' });
  });

  it('inserts a document into audit_logs with a hash field', async () => {
    mockFindOne.mockResolvedValue(null); // no previous entry
    await writeAuditLog(makeBaseEntry());
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted).toHaveProperty('hash');
    expect(typeof inserted.hash).toBe('string');
    expect(inserted.hash.length).toBeGreaterThan(0);
  });

  it('sets previousHash to undefined when there is no prior entry', async () => {
    mockFindOne.mockResolvedValue(null);
    await writeAuditLog(makeBaseEntry());
    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted.previousHash).toBeUndefined();
  });

  it('chains previousHash from the last existing entry', async () => {
    const lastHash = 'abc123prevhash';
    mockFindOne.mockResolvedValue({ hash: lastHash });
    await writeAuditLog(makeBaseEntry());
    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted.previousHash).toBe(lastHash);
  });

  it('produces a deterministic hash that matches computeAuditHash', async () => {
    mockFindOne.mockResolvedValue(null);
    await writeAuditLog(makeBaseEntry());
    const inserted = mockInsertOne.mock.calls[0][0];
    // Re-derive the expected hash from the stored payload
    const payload = {
      actorUserId: inserted.actorUserId,
      actorRole: inserted.actorRole,
      action: inserted.action,
      objectType: inserted.objectType,
      objectId: inserted.objectId,
      requestId: inserted.requestId,
      createdAt: inserted.createdAt.toISOString(),
      previousHash: undefined,
    };
    const expected = computeAuditHash(JSON.stringify(payload), undefined);
    expect(inserted.hash).toBe(expected);
  });

  it('sanitizes sensitive fields in oldValue and newValue before storing', async () => {
    mockFindOne.mockResolvedValue(null);
    await writeAuditLog(makeBaseEntry({
      oldValue: { passwordHash: 'secret', username: 'alice' },
      newValue: { token: 'tok123', email: 'a@b.com' },
    }));
    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted.oldValue.passwordHash).toBe('[REDACTED]');
    expect(inserted.oldValue.username).toBe('alice');
    expect(inserted.newValue.token).toBe('[REDACTED]');
    expect(inserted.newValue.email).toBe('a@b.com');
  });

  it('sanitizes all known sensitive field names', async () => {
    mockFindOne.mockResolvedValue(null);
    const sensitiveFields = ['passwordHash', 'password', 'jwt', 'csrfToken', 'encryptedEmbedding', 'token'];
    await writeAuditLog(makeBaseEntry({
      newValue: Object.fromEntries(sensitiveFields.map(k => [k, 'leak'])),
    }));
    const inserted = mockInsertOne.mock.calls[0][0];
    for (const field of sensitiveFields) {
      expect(inserted.newValue[field]).toBe('[REDACTED]');
    }
  });

  it('does not modify non-sensitive fields in oldValue/newValue', async () => {
    mockFindOne.mockResolvedValue(null);
    await writeAuditLog(makeBaseEntry({
      oldValue: { status: 'active', count: 5 },
    }));
    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted.oldValue.status).toBe('active');
    expect(inserted.oldValue.count).toBe(5);
  });

  it('sets createdAt to a recent Date', async () => {
    mockFindOne.mockResolvedValue(null);
    const before = new Date();
    await writeAuditLog(makeBaseEntry());
    const after = new Date();
    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(inserted.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(inserted.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ── verifyAuditChain ──────────────────────────────────────────────────────────

describe('verifyAuditChain()', () => {
  function buildRealEntry(
    entryOverrides: Record<string, unknown> = {},
    previousHash: string | undefined = undefined
  ) {
    const now = new Date();
    const base = {
      actorUserId: 'user-1',
      actorRole: 'administrator',
      action: 'test.action',
      objectType: 'obj',
      objectId: 'id-1',
      requestId: 'req-1',
      ...entryOverrides,
    };
    const payload: Record<string, unknown> = {
      actorUserId: base.actorUserId,
      actorRole: base.actorRole,
      action: base.action,
      objectType: base.objectType,
      objectId: base.objectId,
      requestId: base.requestId,
      createdAt: now.toISOString(),
      previousHash,
    };
    const hash = computeAuditHash(JSON.stringify(payload), previousHash);
    return { ...base, previousHash, hash, createdAt: now, _id: { toString: () => 'id-' + Math.random() } };
  }

  function setupAsyncCursor(docs: unknown[]) {
    const asyncIterable = {
      [Symbol.asyncIterator]: async function* () {
        for (const doc of docs) yield doc;
      },
      sort: jest.fn().mockReturnThis(),
    };
    mockFind.mockReturnValue(asyncIterable);
  }

  beforeEach(() => jest.clearAllMocks());

  it('returns valid: true for an empty log', async () => {
    setupAsyncCursor([]);
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('returns valid: true for a single correctly hashed entry', async () => {
    const entry = buildRealEntry();
    setupAsyncCursor([entry]);
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
  });

  it('returns valid: true for a multi-entry correctly chained log', async () => {
    const e1 = buildRealEntry({}, undefined);
    const e2 = buildRealEntry({}, e1.hash);
    const e3 = buildRealEntry({}, e2.hash);
    setupAsyncCursor([e1, e2, e3]);
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
  });

  it('returns valid: false and brokenAt when previousHash does not match', async () => {
    const e1 = buildRealEntry({}, undefined);
    // e2 has wrong previousHash
    const e2bad = { ...buildRealEntry({}, 'wrong-hash'), previousHash: 'wrong-hash' };
    setupAsyncCursor([e1, e2bad]);
    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBeDefined();
  });

  it('returns valid: false and brokenAt when a hash has been tampered with', async () => {
    const e1 = buildRealEntry({}, undefined);
    const e2 = buildRealEntry({}, e1.hash);
    // Tamper the hash on e2 but keep previousHash correct
    const e2tampered = { ...e2, hash: 'tampered-hash' };
    // e3 references the tampered hash
    const e3 = { ...buildRealEntry({}, e2tampered.hash) };
    setupAsyncCursor([e1, e2tampered, e3]);
    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
  });

  it('treats null previousHash in stored doc as undefined (first entry)', async () => {
    const e1 = buildRealEntry({}, undefined);
    // Simulate MongoDB storing null instead of undefined
    const e1withNull = { ...e1, previousHash: null };
    setupAsyncCursor([e1withNull]);
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
  });
});
