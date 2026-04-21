/**
 * Unit tests for services/reservation.service.ts
 *
 * All MongoDB interactions are mocked.  No DB connection required.
 * Tests focus on:
 *   - idempotency key de-duplication
 *   - time alignment validation
 *   - end-before-start / past-time guard
 *   - duration bounds
 *   - cancellation rules (owner vs staff, timing, version guard)
 *   - check-in window enforcement
 */

import './setup';

// ── mock DB layer ──────────────────────────────────────────────────────────────

const mockFindOne = jest.fn();
const mockInsertOne = jest.fn();
const mockCountDocuments = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFind = jest.fn();

// A minimal session stub that executes the callback immediately
function makeSessionStub() {
  return {
    withTransaction: async (cb: Function) => { await cb({}); },
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

const mockGetCollection = jest.fn().mockReturnValue({
  findOne: mockFindOne,
  insertOne: mockInsertOne,
  countDocuments: mockCountDocuments,
  updateMany: mockUpdateMany,
  deleteMany: mockDeleteMany,
  findOneAndUpdate: mockFindOneAndUpdate,
  find: mockFind,
  updateOne: jest.fn(),
});

const mockGetClient = jest.fn().mockReturnValue({
  startSession: () => makeSessionStub(),
});

jest.mock('../../src/config/db', () => ({
  getCollection: (...args: any[]) => mockGetCollection(...args),
  getClient: () => mockGetClient(),
}));

// Mock businessHours service so isWithinBusinessHours always passes by default
jest.mock('../../src/services/businessHours.service', () => ({
  getEffectiveBusinessHours: jest.fn().mockResolvedValue({
    openTime: '07:00',
    closeTime: '23:00',
  }),
}));

// Mock audit
jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// Mock crypto util
jest.mock('../../src/utils/crypto', () => ({
  generateSecureToken: jest.fn().mockReturnValue('mock-secure-token'),
}));

import { ObjectId } from 'mongodb';
import {
  createReservation,
  cancelReservation,
  checkIn,
} from '../../src/services/reservation.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

/** Returns a future 15-min-aligned ISO string offset minutes from now. */
function futureAligned(offsetMinutes: number): string {
  const base = new Date();
  // round up to next 15-minute boundary
  const ms = base.getTime();
  const aligned = Math.ceil(ms / (15 * 60 * 1000)) * 15 * 60 * 1000;
  return new Date(aligned + offsetMinutes * 60 * 1000).toISOString();
}

function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'),
    isActive: true,
    zoneId: 'zone-1',
    ...overrides,
  };
}

// ── createReservation ──────────────────────────────────────────────────────────

describe('createReservation()', () => {
  const userId = 'user-1';
  const roomId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const ikey = 'ikey-1';

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: no existing reservation by idempotency key
    mockFindOne.mockResolvedValue(null);
    // No membership account → no tier restrictions
    // No membership for blacklist check either
    mockCountDocuments.mockResolvedValue(0);
    // Room found
    mockGetCollection.mockImplementation((name: string) => {
      const col = {
        findOne: mockFindOne,
        insertOne: mockInsertOne,
        countDocuments: mockCountDocuments,
        updateMany: mockUpdateMany,
        deleteMany: mockDeleteMany,
        findOneAndUpdate: mockFindOneAndUpdate,
        find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
        updateOne: jest.fn(),
      };
      if (name === 'rooms') {
        col.findOne = jest.fn().mockResolvedValue(makeRoom());
      }
      return col;
    });
  });

  it('returns existing reservation when idempotency key already exists', async () => {
    const existing = { _id: new ObjectId(), userId, roomId };
    // First findOne (idempotency check) returns existing doc
    const originalGetCollection = mockGetCollection.getMockImplementation()!;
    mockGetCollection.mockImplementation((name: string) => {
      const base = originalGetCollection(name);
      if (name === 'reservations') {
        return { ...base, findOne: jest.fn().mockResolvedValue(existing) };
      }
      return base;
    });

    const start = futureAligned(60);
    const end = futureAligned(75);
    const result = await createReservation(userId, roomId, start, end, ikey);

    expect('reservation' in result).toBe(true);
    if ('reservation' in result) {
      expect(result.reservation).toBe(existing);
    }
  });

  it('throws ValidationError when times are not 15-min aligned', async () => {
    const start = new Date(Date.now() + 3600 * 1000);
    start.setSeconds(1); // not aligned
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    await expect(
      createReservation(userId, roomId, start.toISOString(), end.toISOString(), ikey)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when end <= start', async () => {
    const t = futureAligned(60);
    await expect(
      createReservation(userId, roomId, t, t, ikey)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns conflict past_time_not_allowed for a past start time', async () => {
    const pastStart = new Date(Date.now() - 60 * 60 * 1000);
    // round to previous 15-min boundary
    const ms = pastStart.getTime();
    const aligned = Math.floor(ms / (15 * 60 * 1000)) * 15 * 60 * 1000;
    const start = new Date(aligned);
    const end = new Date(aligned + 30 * 60 * 1000);

    const result = await createReservation(userId, roomId, start.toISOString(), end.toISOString(), ikey);

    expect('conflict' in result).toBe(true);
    if ('conflict' in result) {
      expect(result.reason).toBe('past_time_not_allowed');
    }
  });

  it('returns conflict duration_invalid when duration is too short', async () => {
    // 0 minutes (immediate end = start + 0 — already rejected by end>start guard)
    // Use less than DEFAULT_MIN_RESERVATION_MINUTES (15)
    // But times must be aligned; 15 is the minimum so test the edge: aligned to 15 but 0 duration
    // Instead test below min: start+0 is blocked by end>start — so test by having zero minutes
    // We cannot go below 15 min with 15-min alignment, so we cannot test duration < minimum.
    // Test duration > maximum (240 min) which is clearly testable.
    const start = futureAligned(60);
    const end = futureAligned(60 + 255); // 255 minutes > 240 max

    const result = await createReservation(userId, roomId, start, end, ikey);

    expect('conflict' in result).toBe(true);
    if ('conflict' in result) {
      expect(result.reason).toBe('duration_invalid');
    }
  });

  it('returns conflict resource_inactive when room is inactive', async () => {
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'rooms'
        ? jest.fn().mockResolvedValue(makeRoom({ isActive: false }))
        : jest.fn().mockResolvedValue(null),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      deleteMany: mockDeleteMany,
      findOneAndUpdate: mockFindOneAndUpdate,
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn(),
    }));

    const start = futureAligned(60);
    const end = futureAligned(75);
    const result = await createReservation(userId, roomId, start, end, ikey);

    expect('conflict' in result).toBe(true);
    if ('conflict' in result) {
      expect(result.reason).toBe('resource_inactive');
    }
  });

  it('throws NotFoundError when room does not exist', async () => {
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      deleteMany: mockDeleteMany,
      findOneAndUpdate: mockFindOneAndUpdate,
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn(),
    }));

    const start = futureAligned(60);
    const end = futureAligned(75);
    await expect(
      createReservation(userId, roomId, start, end, ikey)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns conflict blacklisted_user when membership is blacklisted', async () => {
    const blacklistedMembership = { userId, isBlacklisted: true };

    mockGetCollection.mockImplementation((name: string) => {
      const base = {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: mockInsertOne,
        countDocuments: mockCountDocuments,
        updateMany: mockUpdateMany,
        deleteMany: mockDeleteMany,
        findOneAndUpdate: mockFindOneAndUpdate,
        find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
        updateOne: jest.fn(),
      };
      if (name === 'rooms') {
        return { ...base, findOne: jest.fn().mockResolvedValue(makeRoom()) };
      }
      if (name === 'membership_accounts') {
        return { ...base, findOne: jest.fn().mockResolvedValue(blacklistedMembership) };
      }
      return base;
    });

    const start = futureAligned(60);
    const end = futureAligned(75);
    const result = await createReservation(userId, roomId, start, end, ikey);

    expect('conflict' in result).toBe(true);
    if ('conflict' in result) {
      expect(result.reason).toBe('blacklisted_user');
    }
  });
});

// ── cancelReservation ──────────────────────────────────────────────────────────

describe('cancelReservation()', () => {
  const userId = 'user-1';
  const reservationId = new ObjectId().toString();

  function makeConfirmedReservation(overrides: Record<string, unknown> = {}) {
    return {
      _id: new ObjectId(reservationId),
      userId,
      roomId: 'room-1',
      startAtUtc: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      endAtUtc: new Date(Date.now() + 2 * 60 * 60 * 1000),
      status: 'confirmed',
      version: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    const session = makeSessionStub();
    mockGetClient.mockReturnValue({ startSession: () => session });

    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedReservation())
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(makeConfirmedReservation({ status: 'canceled' })),
      deleteMany: jest.fn().mockResolvedValue({}),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));
  });

  it('throws NotFoundError when reservation does not exist', async () => {
    mockGetCollection.mockImplementation(() => ({
      findOne: jest.fn().mockResolvedValue(null),
    }));

    await expect(
      cancelReservation(reservationId, userId, ['member'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when a non-owner non-staff user tries to cancel', async () => {
    await expect(
      cancelReservation(reservationId, 'other-user', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when only moderator (not admin) cancels a checked-in reservation', async () => {
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedReservation({ status: 'checked_in' }))
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({}),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    await expect(
      cancelReservation(reservationId, userId, ['moderator'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError when reservation is in completed status', async () => {
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedReservation({ status: 'completed' }))
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({}),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    await expect(
      cancelReservation(reservationId, userId, ['member'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when owner tries to cancel after start time', async () => {
    // startAtUtc in the past
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(
            makeConfirmedReservation({
              startAtUtc: new Date(Date.now() - 10 * 60 * 1000), // started 10 min ago
            })
          )
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({}),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    await expect(
      cancelReservation(reservationId, userId, ['member'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when staff cancels without a reason', async () => {
    await expect(
      cancelReservation(reservationId, userId, ['creator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns the updated reservation when staff cancels with a reason', async () => {
    const canceled = makeConfirmedReservation({ status: 'canceled' });
    const findOneAndUpdateMock = jest.fn().mockResolvedValue(canceled);
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedReservation())
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: findOneAndUpdateMock,
      deleteMany: jest.fn().mockResolvedValue({}),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    const result = await cancelReservation(reservationId, userId, ['creator'], 'Policy violation');
    expect(result.status).toBe('canceled');
  });

  it('returns the updated reservation when owner cancels before start', async () => {
    const canceled = makeConfirmedReservation({ status: 'canceled' });
    const findOneAndUpdateMock = jest.fn().mockResolvedValue(canceled);
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedReservation())
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: findOneAndUpdateMock,
      deleteMany: jest.fn().mockResolvedValue({}),
      insertOne: mockInsertOne,
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    const result = await cancelReservation(reservationId, userId, ['member']);
    expect(result.status).toBe('canceled');
  });
});

// ── checkIn ────────────────────────────────────────────────────────────────────

describe('checkIn()', () => {
  const reservationId = new ObjectId().toString();
  const performedBy = 'staff-1';

  function makeConfirmedFutureReservation(startOffsetMinutes = 10) {
    const now = Date.now();
    return {
      _id: new ObjectId(reservationId),
      userId: 'user-1',
      startAtUtc: new Date(now + startOffsetMinutes * 60 * 1000),
      endAtUtc: new Date(now + (startOffsetMinutes + 60) * 60 * 1000),
      status: 'confirmed',
      version: 1,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedFutureReservation())
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(
        makeConfirmedFutureReservation()
      ),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      deleteMany: jest.fn().mockResolvedValue({}),
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));
  });

  it('throws NotFoundError when reservation does not exist', async () => {
    mockGetCollection.mockImplementation(() => ({
      findOne: jest.fn().mockResolvedValue(null),
    }));

    await expect(
      checkIn(reservationId, performedBy, 'manual')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when reservation is already checked_in', async () => {
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue({ ...makeConfirmedFutureReservation(), status: 'checked_in' })
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      deleteMany: jest.fn().mockResolvedValue({}),
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    await expect(
      checkIn(reservationId, performedBy, 'manual')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when check-in window has not opened yet', async () => {
    // startAtUtc is 30 min from now; window opens 15 min before → window not open yet
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedFutureReservation(30))
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      deleteMany: jest.fn().mockResolvedValue({}),
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    await expect(
      checkIn(reservationId, performedBy, 'manual')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when checking in after reservation end time', async () => {
    const now = Date.now();
    const pastReservation = {
      _id: new ObjectId(reservationId),
      userId: 'user-1',
      startAtUtc: new Date(now - 120 * 60 * 1000),
      endAtUtc: new Date(now - 60 * 60 * 1000), // ended 1 hour ago
      status: 'confirmed',
      version: 1,
    };

    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(pastReservation)
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      deleteMany: jest.fn().mockResolvedValue({}),
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    await expect(
      checkIn(reservationId, performedBy, 'manual')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('succeeds when within check-in window (start in 5 min)', async () => {
    // Window opens 15 min before start; start in 5 min → already in window
    const checkedIn = { ...makeConfirmedFutureReservation(5), status: 'checked_in' };
    mockGetCollection.mockImplementation((name: string) => ({
      findOne: name === 'reservations'
        ? jest.fn().mockResolvedValue(makeConfirmedFutureReservation(5))
        : jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(checkedIn),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      deleteMany: jest.fn().mockResolvedValue({}),
      countDocuments: mockCountDocuments,
      updateMany: mockUpdateMany,
      updateOne: jest.fn(),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    }));

    const result = await checkIn(reservationId, performedBy, 'staff');
    expect(result.status).toBe('checked_in');
  });
});
