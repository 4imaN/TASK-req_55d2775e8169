/**
 * Unit tests for services/membership.service.ts
 *
 * All MongoDB interactions are mocked.
 * Tests cover:
 *   - getMembershipAccount: auto-creates on first access
 *   - createTier: name/description validation, duplicate detection
 *   - updateTier: not-found, version conflict, field patching
 *   - assignTier: invalid tier ID, inactive tier, null assignment (remove tier)
 *   - getUserMembership: resolves tier details
 */

import './setup';

// ── mock DB ────────────────────────────────────────────────────────────────────

const mockAccountsFindOne = jest.fn();
const mockAccountsInsertOne = jest.fn();
const mockAccountsFindOneAndUpdate = jest.fn();
const mockAccountsUpdateOne = jest.fn();

const mockTiersFindOne = jest.fn();
const mockTiersInsertOne = jest.fn();
const mockTiersFindOneAndUpdate = jest.fn();
const mockTiersFind = jest.fn();

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'membership_accounts') {
      return {
        findOne: mockAccountsFindOne,
        insertOne: mockAccountsInsertOne,
        findOneAndUpdate: mockAccountsFindOneAndUpdate,
        updateOne: mockAccountsUpdateOne,
      };
    }
    if (name === 'membership_tiers') {
      return {
        findOne: mockTiersFindOne,
        insertOne: mockTiersInsertOne,
        findOneAndUpdate: mockTiersFindOneAndUpdate,
        find: mockTiersFind,
      };
    }
    if (name === 'users') {
      return {
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      };
    }
    return { findOne: jest.fn(), insertOne: jest.fn() };
  },
}));

jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { ObjectId } from 'mongodb';
import {
  getMembershipAccount,
  createTier,
  updateTier,
  assignTier,
  getUserMembership,
} from '../../src/services/membership.service';
import { ValidationError, NotFoundError, ConflictError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

const tierId = new ObjectId().toString();
const userId = 'user-1';

function makeTier(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(tierId),
    name: 'Gold',
    description: 'Gold tier benefits',
    benefits: { maxReservationMinutes: 120, maxConcurrentReservations: 3 },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId,
    tierId: null,
    pointsBalance: 0,
    walletBalanceCents: 0,
    isBlacklisted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

// ── getMembershipAccount ───────────────────────────────────────────────────────

describe('getMembershipAccount()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing account without creating a new one', async () => {
    const account = makeAccount();
    mockAccountsFindOne.mockResolvedValue(account);

    const result = await getMembershipAccount(userId);
    expect(result.userId).toBe(userId);
    expect(mockAccountsInsertOne).not.toHaveBeenCalled();
  });

  it('auto-creates an account when none exists', async () => {
    mockAccountsFindOne
      .mockResolvedValueOnce(null)            // first lookup — not found
      .mockResolvedValueOnce(makeAccount());   // lookup after insert

    mockAccountsInsertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const result = await getMembershipAccount(userId);
    expect(mockAccountsInsertOne).toHaveBeenCalledTimes(1);
    expect(result.userId).toBe(userId);
  });

  it('auto-created account has zero points and zero balance', async () => {
    const newAccount = makeAccount({ pointsBalance: 0, walletBalanceCents: 0 });
    mockAccountsFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(newAccount);
    mockAccountsInsertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const result = await getMembershipAccount(userId);
    expect(result.pointsBalance).toBe(0);
    expect(result.walletBalanceCents).toBe(0);
    expect(result.isBlacklisted).toBe(false);
  });
});

// ── createTier ────────────────────────────────────────────────────────────────

describe('createTier()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTiersFindOne.mockResolvedValue(null); // no duplicate
    mockTiersInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it('throws ValidationError when name is empty', async () => {
    await expect(createTier('', 'desc', {}, 'admin')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when description is empty', async () => {
    await expect(createTier('Gold', '', {}, 'admin')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ConflictError when tier name already exists', async () => {
    mockTiersFindOne.mockResolvedValue(makeTier());
    await expect(createTier('Gold', 'desc', {}, 'admin')).rejects.toBeInstanceOf(ConflictError);
  });

  it('creates a tier successfully', async () => {
    const insertedId = new ObjectId();
    mockTiersInsertOne.mockResolvedValue({ insertedId });
    mockTiersFindOne
      .mockResolvedValueOnce(null)                          // duplicate check
      .mockResolvedValueOnce(makeTier({ _id: insertedId })); // fetch after insert

    const result = await createTier('Gold', 'Gold tier', { maxReservationMinutes: 120 }, 'admin');
    expect(result.name).toBe('Gold');
    expect(result.isActive).toBe(true);
  });

  it('trims whitespace from name and description', async () => {
    const insertedId = new ObjectId();
    mockTiersInsertOne.mockResolvedValue({ insertedId });
    mockTiersFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeTier({ name: 'Silver', description: 'Silver tier', _id: insertedId }));

    await createTier('  Silver  ', '  Silver tier  ', {}, 'admin');

    const insertCall = mockTiersInsertOne.mock.calls[0][0];
    expect(insertCall.name).toBe('Silver');
    expect(insertCall.description).toBe('Silver tier');
  });
});

// ── updateTier ────────────────────────────────────────────────────────────────

describe('updateTier()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTiersFindOne.mockResolvedValue(makeTier());
    mockTiersFindOneAndUpdate.mockResolvedValue(makeTier({ name: 'Platinum' }));
  });

  it('throws ValidationError for an invalid tier ID', async () => {
    await expect(updateTier('not-an-oid', {}, 1, 'admin')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when tier does not exist', async () => {
    mockTiersFindOne.mockResolvedValue(null);
    await expect(updateTier(tierId, {}, 1, 'admin')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when version does not match', async () => {
    mockTiersFindOne.mockResolvedValue(makeTier({ version: 2 }));
    // Caller passes version 1 but stored is 2
    await expect(updateTier(tierId, {}, 1, 'admin')).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ConflictError when findOneAndUpdate returns null (concurrent update)', async () => {
    mockTiersFindOneAndUpdate.mockResolvedValue(null);
    await expect(updateTier(tierId, {}, 1, 'admin')).rejects.toBeInstanceOf(ConflictError);
  });

  it('updates name when provided', async () => {
    const updated = makeTier({ name: 'Platinum' });
    mockTiersFindOneAndUpdate.mockResolvedValue(updated);

    const result = await updateTier(tierId, { name: 'Platinum' }, 1, 'admin');
    expect(result.name).toBe('Platinum');
  });

  it('deactivates a tier when isActive: false is passed', async () => {
    const updated = makeTier({ isActive: false });
    mockTiersFindOneAndUpdate.mockResolvedValue(updated);

    const result = await updateTier(tierId, { isActive: false }, 1, 'admin');
    expect(result.isActive).toBe(false);
  });
});

// ── assignTier ────────────────────────────────────────────────────────────────

describe('assignTier()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTiersFindOne.mockResolvedValue(makeTier());
    mockAccountsFindOne.mockResolvedValue(makeAccount());
    mockAccountsFindOneAndUpdate.mockResolvedValue(makeAccount({ tierId }));
    mockAccountsInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it('throws ValidationError for an invalid tier ObjectId', async () => {
    await expect(assignTier(userId, 'bad-id', 'admin')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when tier does not exist or is inactive', async () => {
    mockTiersFindOne.mockResolvedValue(null); // tier lookup returns null
    await expect(assignTier(userId, tierId, 'admin')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('assigns a valid tier to a user', async () => {
    const result = await assignTier(userId, tierId, 'admin');
    expect(result.tierId).toBe(tierId);
  });

  it('allows assigning null to remove a tier', async () => {
    mockAccountsFindOneAndUpdate.mockResolvedValue(makeAccount({ tierId: null }));
    const result = await assignTier(userId, null, 'admin');
    expect(result.tierId).toBeNull();
    // Should NOT attempt to look up tier when tierId is null
    expect(mockTiersFindOne).not.toHaveBeenCalled();
  });
});

// ── getUserMembership ─────────────────────────────────────────────────────────

describe('getUserMembership()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccountsFindOne.mockResolvedValue(makeAccount({ tierId }));
    mockTiersFindOne.mockResolvedValue(makeTier());
    mockAccountsInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it('returns both account and tier when tier is assigned', async () => {
    const result = await getUserMembership(userId);
    expect(result.account.tierId).toBe(tierId);
    expect(result.tier).not.toBeNull();
    expect(result.tier!.name).toBe('Gold');
  });

  it('returns null tier when no tier is assigned', async () => {
    mockAccountsFindOne.mockResolvedValue(makeAccount({ tierId: null }));
    const result = await getUserMembership(userId);
    expect(result.tier).toBeNull();
  });

  it('returns null tier when tierId is an invalid ObjectId', async () => {
    mockAccountsFindOne.mockResolvedValue(makeAccount({ tierId: 'invalid-oid' }));
    const result = await getUserMembership(userId);
    expect(result.tier).toBeNull();
  });
});
