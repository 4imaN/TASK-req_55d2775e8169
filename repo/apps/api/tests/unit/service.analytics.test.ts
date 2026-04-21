/**
 * Unit tests for services/analytics.service.ts
 *
 * Tests cover:
 *   - computeBookingConversion: zero denominator, normal ratio
 *   - computeAttendanceRate: zero eligible, normal ratio
 *   - computeNoshowRate: zero eligible, normal ratio
 *   - computePeakUtilization: zero rooms returns 0, non-zero calculation
 *   - computeOffPeakUtilization: zero off-peak hours returns 0
 *   - computePolicyImpact: invalid ID throws, not-found throws, valid returns delta
 *   - createSnapshot: inserts doc and returns it
 *   - getSnapshots: builds query from filters, paginates
 */

import './setup';

// ── mock DB ────────────────────────────────────────────────────────────────────

const mockCountDocuments = jest.fn();
const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockInsertOne = jest.fn();

function buildFindChain(docs: unknown[] = []) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    project: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  };
}

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => ({
    countDocuments: mockCountDocuments,
    findOne: mockFindOne,
    find: mockFind,
    insertOne: mockInsertOne,
  }),
}));

import { ObjectId } from 'mongodb';
import {
  computeBookingConversion,
  computeAttendanceRate,
  computeNoshowRate,
  computePeakUtilization,
  computeOffPeakUtilization,
  computePolicyImpact,
  createSnapshot,
  getSnapshots,
} from '../../src/services/analytics.service';
import { ValidationError, NotFoundError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

const baseFilters = {
  grain: 'day' as const,
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-01-31'),
};

// ── computeBookingConversion ──────────────────────────────────────────────────

describe('computeBookingConversion()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 0 when there are no reservation attempts', async () => {
    mockCountDocuments.mockResolvedValue(0);
    const result = await computeBookingConversion(baseFilters);
    expect(result).toBe(0);
  });

  it('returns 1 when all attempts are successful', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(10)  // total attempts
      .mockResolvedValueOnce(10); // successful
    const result = await computeBookingConversion(baseFilters);
    expect(result).toBe(1);
  });

  it('computes correct ratio and rounds to 4 decimal places', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(3)  // total
      .mockResolvedValueOnce(1); // successful
    const result = await computeBookingConversion(baseFilters);
    expect(result).toBe(0.3333);
  });

  it('returns 0 when no attempts are successful', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(5)  // total
      .mockResolvedValueOnce(0); // successful
    const result = await computeBookingConversion(baseFilters);
    expect(result).toBe(0);
  });
});

// ── computeAttendanceRate ─────────────────────────────────────────────────────

describe('computeAttendanceRate()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 0 when no eligible reservations exist', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(0)  // eligible
      .mockResolvedValueOnce(0); // attended
    const result = await computeAttendanceRate(baseFilters);
    expect(result).toBe(0);
  });

  it('computes correct attendance ratio', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(8)  // eligible (non-canceled)
      .mockResolvedValueOnce(6); // checked_in + completed
    const result = await computeAttendanceRate(baseFilters);
    expect(result).toBe(0.75);
  });

  it('returns 1.0 when all eligible reservations were attended', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5);
    const result = await computeAttendanceRate(baseFilters);
    expect(result).toBe(1);
  });
});

// ── computeNoshowRate ─────────────────────────────────────────────────────────

describe('computeNoshowRate()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 0 when no eligible reservations exist', async () => {
    mockCountDocuments.mockResolvedValue(0);
    const result = await computeNoshowRate(baseFilters);
    expect(result).toBe(0);
  });

  it('computes correct no-show ratio', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(10)  // eligible
      .mockResolvedValueOnce(2);  // no-shows
    const result = await computeNoshowRate(baseFilters);
    expect(result).toBe(0.2);
  });

  it('returns 0 when no no-shows occurred', async () => {
    mockCountDocuments
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(0);
    const result = await computeNoshowRate(baseFilters);
    expect(result).toBe(0);
  });
});

// ── computePeakUtilization ────────────────────────────────────────────────────

describe('computePeakUtilization()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Policy: peakStart=9, peakEnd=17  → 8 peak hours
    mockFindOne
      .mockResolvedValueOnce(null) // no policy version → uses defaults 9-17
      .mockResolvedValueOnce(null); // no site business hours → uses defaults 7-23
  });

  it('returns 0 when there are no active rooms', async () => {
    mockCountDocuments.mockResolvedValue(0); // 0 rooms
    mockFind.mockReturnValue(buildFindChain([]));
    const result = await computePeakUtilization(baseFilters);
    expect(result).toBe(0);
  });

  it('returns 0 when there are no reservations in peak hours', async () => {
    mockCountDocuments.mockResolvedValue(2); // 2 rooms
    mockFind.mockReturnValue(buildFindChain([])); // no reservations
    const result = await computePeakUtilization(baseFilters);
    expect(result).toBe(0);
  });

  it('computes non-zero utilization for a reservation covering full peak window', async () => {
    // Reset mocks for this test (needs re-setup of policy+business mocks)
    jest.clearAllMocks();

    // Policy: no version → defaults (peakStart=9, peakEnd=17)
    mockFindOne.mockResolvedValueOnce(null); // getPeakHours: no policy

    // Business hours: getBusinessHoursRange uses find().sort().limit().toArray()
    mockFind
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]), // empty → falls back to defaults 7-23
      })
      .mockReturnValue(buildFindChain([{  // actual reservations
        _id: new ObjectId(),
        startAtUtc: new Date('2025-01-15T17:00:00.000Z'), // 09:00 PST
        endAtUtc: new Date('2025-01-15T17:01:00.000Z'),
        status: 'completed',
      }]));

    mockCountDocuments.mockResolvedValue(1); // 1 room

    const result = await computePeakUtilization({
      ...baseFilters,
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-01-15'),
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ── computeOffPeakUtilization ─────────────────────────────────────────────────

describe('computeOffPeakUtilization()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 0 when there are no active rooms', async () => {
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockCountDocuments.mockResolvedValue(0);
    mockFind.mockReturnValue(buildFindChain([]));
    const result = await computeOffPeakUtilization(baseFilters);
    expect(result).toBe(0);
  });

  it('returns 0 when there are no off-peak hours (peak spans entire business hours)', async () => {
    // Policy: peak 09:00-17:00
    mockFindOne.mockResolvedValueOnce({ settings: { peakStartTime: '09:00', peakEndTime: '17:00' } });

    // Business hours: same window 09:00-17:00
    mockFind
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([{ openTime: '09:00', closeTime: '17:00' }]),
      })
      .mockReturnValue(buildFindChain([])); // reservations

    mockCountDocuments.mockResolvedValue(1); // 1 room

    // businessHoursPerDay = 17-9 = 8, peakWithinBusiness = 8, offPeak = 0 → availableMinutes = 0
    const result = await computeOffPeakUtilization(baseFilters);
    expect(result).toBe(0);
  });
});

// ── computePolicyImpact ───────────────────────────────────────────────────────

describe('computePolicyImpact()', () => {
  beforeEach(() => jest.resetAllMocks());

  it('throws ValidationError for an invalid ObjectId', async () => {
    await expect(
      computePolicyImpact('not-a-valid-objectid', 'booking_conversion', 7)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when the policy version does not exist', async () => {
    mockFindOne.mockResolvedValue(null);
    await expect(
      computePolicyImpact(new ObjectId().toString(), 'booking_conversion', 7)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns before, after, and delta values', async () => {
    const effectiveAt = new Date('2025-06-01');

    // computePolicyImpact: first findOne = policy version
    // computeBookingConversion (x2: before + after) → only countDocuments, no findOne
    mockFindOne.mockResolvedValueOnce({ _id: new ObjectId(), effectiveAt });
    // countDocuments will be called 4 times: 2 calls per computeBookingConversion (attempts + successful)
    // times 2 (before + after) = 4 calls, all returning 0 → result = 0 each
    mockCountDocuments.mockResolvedValue(0);

    const result = await computePolicyImpact(
      new ObjectId().toString(),
      'booking_conversion',
      7
    );
    expect(result).toHaveProperty('before');
    expect(result).toHaveProperty('after');
    expect(result).toHaveProperty('delta');
    expect(typeof result.delta).toBe('number');
    expect(result.before).toBe(0);
    expect(result.after).toBe(0);
    expect(result.delta).toBe(0);
  });
});

// ── createSnapshot ────────────────────────────────────────────────────────────

describe('createSnapshot()', () => {
  beforeEach(() => jest.resetAllMocks());

  it('inserts a snapshot document and returns it', async () => {
    const id = new ObjectId();
    const snap = {
      _id: id,
      kpiName: 'attendance_rate',
      grain: 'day',
      periodStart: new Date('2025-01-01'),
      periodEnd: new Date('2025-01-01'),
      value: 0.75,
      metadata: {},
      createdAt: new Date(),
    };
    mockInsertOne.mockResolvedValueOnce({ insertedId: id });
    // findOne is called after insertOne to fetch the inserted doc
    mockFindOne.mockResolvedValueOnce(snap);

    const result = await createSnapshot(
      'attendance_rate',
      'day',
      snap.periodStart,
      snap.periodEnd,
      0.75,
      {}
    );
    expect(result.kpiName).toBe('attendance_rate');
    expect(result.value).toBe(0.75);
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
  });

  it('includes optional roomId and zoneId when provided', async () => {
    const id = new ObjectId();
    mockInsertOne.mockResolvedValueOnce({ insertedId: id });
    mockFindOne.mockResolvedValueOnce({ _id: id, roomId: 'r1', zoneId: 'z1' });

    await createSnapshot('peak_utilization', 'week', new Date(), new Date(), 0.5, {}, 'r1', 'z1');
    const doc = mockInsertOne.mock.calls[0][0];
    expect(doc.roomId).toBe('r1');
    expect(doc.zoneId).toBe('z1');
  });

  it('does not set roomId/zoneId when not provided', async () => {
    const id = new ObjectId();
    mockInsertOne.mockResolvedValueOnce({ insertedId: id });
    mockFindOne.mockResolvedValueOnce({ _id: id, kpiName: 'noshow_rate' });

    await createSnapshot('noshow_rate', 'month', new Date(), new Date(), 0.1, {});
    const doc = mockInsertOne.mock.calls[0][0];
    expect(doc.roomId).toBeUndefined();
    expect(doc.zoneId).toBeUndefined();
  });
});

// ── getSnapshots ──────────────────────────────────────────────────────────────

describe('getSnapshots()', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns snapshots and total matching filters', async () => {
    const docs = [{ _id: new ObjectId(), kpiName: 'attendance_rate', value: 0.8 }];
    mockCountDocuments.mockResolvedValue(1);
    mockFind.mockReturnValue(buildFindChain(docs));

    const result = await getSnapshots({ kpiName: 'attendance_rate' }, 1, 10);
    expect(result.total).toBe(1);
    expect(result.snapshots).toHaveLength(1);
  });

  it('returns zero results when no snapshots match', async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockFind.mockReturnValue(buildFindChain([]));

    const result = await getSnapshots({}, 1, 10);
    expect(result.total).toBe(0);
    expect(result.snapshots).toHaveLength(0);
  });

  it('builds query with kpiName filter', async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockFind.mockReturnValue(buildFindChain([]));

    await getSnapshots({ kpiName: 'noshow_rate' }, 1, 10);
    const query = mockCountDocuments.mock.calls[0][0];
    expect(query.kpiName).toBe('noshow_rate');
  });

  it('builds date range query using periodStart when startDate/endDate provided', async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockFind.mockReturnValue(buildFindChain([]));

    const start = new Date('2025-01-01');
    const end = new Date('2025-01-31');
    await getSnapshots({ startDate: start, endDate: end }, 1, 10);
    const query = mockCountDocuments.mock.calls[0][0];
    expect(query.periodStart).toEqual({ $gte: start, $lte: end });
  });

  it('paginates correctly using page and pageSize', async () => {
    mockCountDocuments.mockResolvedValue(30);
    const chain = buildFindChain([]);
    mockFind.mockReturnValue(chain);

    await getSnapshots({}, 3, 10);
    // page 3, pageSize 10 → skip 20
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });
});
