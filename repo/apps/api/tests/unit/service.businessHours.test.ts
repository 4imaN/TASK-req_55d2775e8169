/**
 * Unit tests for services/businessHours.service.ts
 *
 * Tests cover:
 *   - setBusinessHours: input validation (dayOfWeek, time format, time order, scopeId)
 *   - setBusinessHours: inserts new entry when none exists
 *   - setBusinessHours: updates existing entry when one already exists
 *   - getBusinessHours: returns sorted active entries for a scope
 *   - getEffectiveBusinessHours: room override > zone override > site default > null
 *   - deleteBusinessHours: calls deleteOne and throws NotFoundError when not deleted
 *   - seedDefaultBusinessHours: skips if already seeded, inserts 7 docs when empty
 */

import './setup';

// ── mock DB ────────────────────────────────────────────────────────────────────

const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockInsertOne = jest.fn();
const mockInsertMany = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockDeleteOne = jest.fn();
const mockCountDocuments = jest.fn();
const mockUpdateOne = jest.fn();

function collectionMock() {
  return {
    findOne: mockFindOne,
    find: mockFind,
    insertOne: mockInsertOne,
    insertMany: mockInsertMany,
    findOneAndUpdate: mockFindOneAndUpdate,
    deleteOne: mockDeleteOne,
    countDocuments: mockCountDocuments,
    updateOne: mockUpdateOne,
  };
}

jest.mock('../../src/config/db', () => ({
  getCollection: () => collectionMock(),
}));

import { ObjectId } from 'mongodb';
import {
  setBusinessHours,
  getBusinessHours,
  getEffectiveBusinessHours,
  deleteBusinessHours,
  seedDefaultBusinessHours,
} from '../../src/services/businessHours.service';
import { ValidationError, NotFoundError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    scope: 'site',
    scopeId: null,
    dayOfWeek: 1,
    openTime: '08:00',
    closeTime: '22:00',
    isActive: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setupFind(docs: unknown[]) {
  mockFind.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  });
}

// ── setBusinessHours – validation ─────────────────────────────────────────────

describe('setBusinessHours() – validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError for dayOfWeek < 0', async () => {
    await expect(
      setBusinessHours('site', null, -1, '08:00', '22:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for dayOfWeek > 6', async () => {
    await expect(
      setBusinessHours('site', null, 7, '08:00', '22:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid openTime format', async () => {
    await expect(
      setBusinessHours('site', null, 1, '8:00', '22:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid closeTime format', async () => {
    await expect(
      setBusinessHours('site', null, 1, '08:00', '25:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when openTime >= closeTime (equal)', async () => {
    await expect(
      setBusinessHours('site', null, 1, '10:00', '10:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when openTime > closeTime', async () => {
    await expect(
      setBusinessHours('site', null, 1, '20:00', '08:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when scope is zone but no scopeId', async () => {
    await expect(
      setBusinessHours('zone', null, 1, '08:00', '22:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when scope is room but no scopeId', async () => {
    await expect(
      setBusinessHours('room', null, 3, '09:00', '21:00')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts valid 24-hour boundary times', async () => {
    mockFindOne.mockResolvedValue(null);
    const inserted = makeDoc({ scope: 'site', dayOfWeek: 0, openTime: '00:00', closeTime: '23:59' });
    mockInsertOne.mockResolvedValue({ insertedId: inserted._id });
    mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(inserted);
    const result = await setBusinessHours('site', null, 0, '00:00', '23:59');
    expect(result).toBeDefined();
  });
});

// ── setBusinessHours – insert path ────────────────────────────────────────────

describe('setBusinessHours() – insert path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a new document when no existing entry found', async () => {
    const newDoc = makeDoc();
    mockFindOne
      .mockResolvedValueOnce(null)   // no existing
      .mockResolvedValueOnce(newDoc); // findOne after insert
    mockInsertOne.mockResolvedValue({ insertedId: newDoc._id });

    const result = await setBusinessHours('site', null, 1, '08:00', '22:00');
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ scope: 'site', dayOfWeek: 1 });
  });

  it('sets scopeId to null for site scope', async () => {
    const newDoc = makeDoc({ scopeId: null });
    mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newDoc);
    mockInsertOne.mockResolvedValue({ insertedId: newDoc._id });

    await setBusinessHours('site', null, 2, '07:00', '23:00');
    const insertedDoc = mockInsertOne.mock.calls[0][0];
    expect(insertedDoc.scopeId).toBeNull();
  });

  it('sets isActive to true for new documents', async () => {
    const newDoc = makeDoc({ isActive: true });
    mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newDoc);
    mockInsertOne.mockResolvedValue({ insertedId: newDoc._id });

    await setBusinessHours('site', null, 3, '08:00', '20:00');
    const insertedDoc = mockInsertOne.mock.calls[0][0];
    expect(insertedDoc.isActive).toBe(true);
  });

  it('sets version to 1 for new documents', async () => {
    const newDoc = makeDoc({ version: 1 });
    mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newDoc);
    mockInsertOne.mockResolvedValue({ insertedId: newDoc._id });

    await setBusinessHours('site', null, 4, '08:00', '20:00');
    const insertedDoc = mockInsertOne.mock.calls[0][0];
    expect(insertedDoc.version).toBe(1);
  });
});

// ── setBusinessHours – update path ────────────────────────────────────────────

describe('setBusinessHours() – update path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls findOneAndUpdate when existing entry found', async () => {
    const existing = makeDoc();
    const updated = makeDoc({ openTime: '09:00', closeTime: '21:00', version: 2 });
    mockFindOne.mockResolvedValueOnce(existing); // existing check
    mockFindOneAndUpdate.mockResolvedValue(updated);

    const result = await setBusinessHours('site', null, 1, '09:00', '21:00');
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(result.openTime).toBe('09:00');
    expect(result.closeTime).toBe('21:00');
  });

  it('does not call insertOne when updating', async () => {
    const existing = makeDoc();
    mockFindOne.mockResolvedValueOnce(existing);
    mockFindOneAndUpdate.mockResolvedValue(makeDoc());

    await setBusinessHours('site', null, 1, '09:00', '21:00');
    expect(mockInsertOne).not.toHaveBeenCalled();
  });
});

// ── getBusinessHours ──────────────────────────────────────────────────────────

describe('getBusinessHours()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns sorted active entries for site scope', async () => {
    const docs = [makeDoc({ dayOfWeek: 0 }), makeDoc({ dayOfWeek: 1 })];
    setupFind(docs);
    const result = await getBusinessHours('site');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  it('returns empty array when no active hours exist', async () => {
    setupFind([]);
    const result = await getBusinessHours('site');
    expect(result).toHaveLength(0);
  });

  it('queries with scopeId when provided', async () => {
    setupFind([makeDoc({ scope: 'room', scopeId: 'room-1' })]);
    await getBusinessHours('room', 'room-1');
    const query = mockFind.mock.calls[0][0];
    expect(query.scopeId).toBe('room-1');
  });

  it('queries with scopeId null when not provided', async () => {
    setupFind([]);
    await getBusinessHours('site');
    const query = mockFind.mock.calls[0][0];
    expect(query.scopeId).toBeNull();
  });
});

// ── getEffectiveBusinessHours ─────────────────────────────────────────────────

describe('getEffectiveBusinessHours()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns room hours when a room override exists (highest priority)', async () => {
    const roomDoc = makeDoc({ scope: 'room', scopeId: 'room-1', openTime: '10:00', closeTime: '16:00' });
    mockFindOne.mockResolvedValueOnce(roomDoc); // room check
    const result = await getEffectiveBusinessHours('room-1', 'zone-1', 1);
    expect(result).toEqual({ openTime: '10:00', closeTime: '16:00' });
  });

  it('falls back to zone hours when no room override exists', async () => {
    const zoneDoc = makeDoc({ scope: 'zone', scopeId: 'zone-1', openTime: '11:00', closeTime: '17:00' });
    mockFindOne
      .mockResolvedValueOnce(null)    // no room override
      .mockResolvedValueOnce(zoneDoc); // zone override
    const result = await getEffectiveBusinessHours('room-1', 'zone-1', 1);
    expect(result).toEqual({ openTime: '11:00', closeTime: '17:00' });
  });

  it('falls back to site hours when no room or zone override exists', async () => {
    const siteDoc = makeDoc({ scope: 'site', openTime: '07:00', closeTime: '23:00' });
    mockFindOne
      .mockResolvedValueOnce(null)    // no room
      .mockResolvedValueOnce(null)    // no zone
      .mockResolvedValueOnce(siteDoc); // site
    const result = await getEffectiveBusinessHours('room-1', 'zone-1', 1);
    expect(result).toEqual({ openTime: '07:00', closeTime: '23:00' });
  });

  it('returns null when no hours exist at any scope level', async () => {
    mockFindOne
      .mockResolvedValueOnce(null) // no room
      .mockResolvedValueOnce(null) // no zone
      .mockResolvedValueOnce(null); // no site
    const result = await getEffectiveBusinessHours('room-1', 'zone-1', 1);
    expect(result).toBeNull();
  });
});

// ── deleteBusinessHours ───────────────────────────────────────────────────────

describe('deleteBusinessHours()', () => {
  const validId = new ObjectId().toString();

  beforeEach(() => jest.clearAllMocks());

  it('calls deleteOne with the correct ObjectId', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
    await deleteBusinessHours(validId);
    expect(mockDeleteOne).toHaveBeenCalledTimes(1);
    const filter = mockDeleteOne.mock.calls[0][0];
    expect(filter._id).toBeInstanceOf(ObjectId);
  });

  it('throws NotFoundError when deletedCount is 0', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 });
    await expect(deleteBusinessHours(validId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ── seedDefaultBusinessHours ──────────────────────────────────────────────────

describe('seedDefaultBusinessHours()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing when already seeded (countDocuments > 0)', async () => {
    mockCountDocuments.mockResolvedValue(7);
    await seedDefaultBusinessHours();
    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('inserts 7 documents (one per day) when not yet seeded', async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockInsertMany.mockResolvedValue({});
    await seedDefaultBusinessHours();
    expect(mockInsertMany).toHaveBeenCalledTimes(1);
    const docs = mockInsertMany.mock.calls[0][0];
    expect(docs).toHaveLength(7);
    // dayOfWeek values should be 0 through 6
    const days = docs.map((d: any) => d.dayOfWeek).sort((a: number, b: number) => a - b);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('sets isActive to true on all seeded documents', async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockInsertMany.mockResolvedValue({});
    await seedDefaultBusinessHours();
    const docs = mockInsertMany.mock.calls[0][0];
    expect(docs.every((d: any) => d.isActive === true)).toBe(true);
  });

  it('seeds with default business hours times from shared-policy', async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockInsertMany.mockResolvedValue({});
    await seedDefaultBusinessHours();
    const docs = mockInsertMany.mock.calls[0][0];
    // DEFAULT_BUSINESS_HOURS_START = '07:00', DEFAULT_BUSINESS_HOURS_END = '23:00'
    expect(docs[0].openTime).toBe('07:00');
    expect(docs[0].closeTime).toBe('23:00');
  });
});
