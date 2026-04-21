/**
 * Unit tests for services/wallet.service.ts
 *
 * All MongoDB interactions and audit logging are mocked.
 * Tests cover:
 *   - topUp: validation, idempotency, daily risk limit enforcement
 *   - spend: validation, balance check, idempotency, daily risk limit
 *   - refund: validation, invalid original entry, idempotency
 *   - redeemPoints: block-size enforcement, insufficient-points guard
 *   - awardPoints: floor(cents/100) calculation
 *   - getBalance: sum of amountCents entries
 *   - getDailyRiskUsage: sum of absolute amounts for today
 */

import './setup';

// ── mock DB + dependencies ────────────────────────────────────────────────────

const mockLedgerFindOne = jest.fn();
const mockLedgerInsertOne = jest.fn();
const mockLedgerFind = jest.fn();
const mockLedgerCountDocuments = jest.fn();
const mockMembershipFindOne = jest.fn();
const mockMembershipUpdateOne = jest.fn();
const mockMembershipInsertOne = jest.fn();

function ledgerCollectionMock() {
  return {
    findOne: mockLedgerFindOne,
    insertOne: mockLedgerInsertOne,
    find: mockLedgerFind,
    countDocuments: mockLedgerCountDocuments,
    updateOne: jest.fn(),
  };
}

function membershipCollectionMock() {
  return {
    findOne: mockMembershipFindOne,
    insertOne: mockMembershipInsertOne,
    updateOne: mockMembershipUpdateOne,
  };
}

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'ledger_entries') return ledgerCollectionMock();
    if (name === 'membership_accounts') return membershipCollectionMock();
    return { findOne: jest.fn(), insertOne: jest.fn(), find: jest.fn(), updateOne: jest.fn() };
  },
  getClient: () => ({
    startSession: () => ({
      withTransaction: async (cb: Function) => { await cb({}); },
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  }),
}));

jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/membership.service', () => ({
  getMembershipAccount: jest.fn().mockResolvedValue({
    _id: 'acc-id',
    userId: 'user-1',
    tierId: null,
    pointsBalance: 500,
    walletBalanceCents: 0,
    isBlacklisted: false,
    version: 1,
  }),
}));

import { ObjectId } from 'mongodb';
import {
  topUp,
  spend,
  refund,
  redeemPoints,
  awardPoints,
  getBalance,
  getDailyRiskUsage,
} from '../../src/services/wallet.service';
import { getMembershipAccount } from '../../src/services/membership.service';
import { ValidationError, NotFoundError } from '../../src/services/auth.service';

const mockGetMembershipAccount = getMembershipAccount as jest.Mock;

// ── helpers ────────────────────────────────────────────────────────────────────

function makeLedgerEntry(amountCents: number, type = 'topup'): Record<string, unknown> {
  return {
    _id: new ObjectId(),
    userId: 'user-1',
    type,
    amountCents,
    idempotencyKey: 'key-' + Math.random(),
    runningBalanceCents: amountCents,
    createdAt: new Date(),
  };
}

function setupLedgerEntries(entries: ReturnType<typeof makeLedgerEntry>[]) {
  mockLedgerFind.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(entries),
  });
}

// ── getBalance ────────────────────────────────────────────────────────────────

describe('getBalance()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 0 for a user with no ledger entries', async () => {
    setupLedgerEntries([]);
    expect(await getBalance('user-1')).toBe(0);
  });

  it('sums positive entries', async () => {
    setupLedgerEntries([
      makeLedgerEntry(1000),
      makeLedgerEntry(500),
    ]);
    expect(await getBalance('user-1')).toBe(1500);
  });

  it('subtracts negative entries (spend)', async () => {
    setupLedgerEntries([
      makeLedgerEntry(1000, 'topup'),
      makeLedgerEntry(-300, 'spend'),
    ]);
    expect(await getBalance('user-1')).toBe(700);
  });

  it('handles a mix of credits and debits', async () => {
    setupLedgerEntries([
      makeLedgerEntry(5000, 'topup'),
      makeLedgerEntry(-2000, 'spend'),
      makeLedgerEntry(1000, 'refund'),
      makeLedgerEntry(-500, 'spend'),
    ]);
    expect(await getBalance('user-1')).toBe(3500);
  });
});

// ── getDailyRiskUsage ─────────────────────────────────────────────────────────

describe('getDailyRiskUsage()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 0 when there are no entries today', async () => {
    mockLedgerFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    expect(await getDailyRiskUsage('user-1')).toBe(0);
  });

  it('sums absolute values of today\'s topup/spend/refund entries', async () => {
    mockLedgerFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        makeLedgerEntry(1000, 'topup'),
        makeLedgerEntry(-300, 'spend'),
        makeLedgerEntry(200, 'refund'),
      ]),
    });
    // |1000| + |-300| + |200| = 1500
    expect(await getDailyRiskUsage('user-1')).toBe(1500);
  });
});

// ── topUp ─────────────────────────────────────────────────────────────────────

describe('topUp()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLedgerFindOne.mockResolvedValue(null); // no idempotency hit
    mockLedgerInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
    mockLedgerFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockMembershipFindOne.mockResolvedValue(null);
    mockMembershipInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
    mockMembershipUpdateOne.mockResolvedValue({});
  });

  it('throws ValidationError for zero amount', async () => {
    await expect(topUp('user-1', 0, 'test', 'admin', 'key-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for negative amount', async () => {
    await expect(topUp('user-1', -100, 'test', 'admin', 'key-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for non-integer amount', async () => {
    await expect(topUp('user-1', 9.99, 'test', 'admin', 'key-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns current balance when idempotency key already exists', async () => {
    const existingEntry = makeLedgerEntry(500, 'topup');
    mockLedgerFindOne.mockResolvedValue(existingEntry);
    // getBalance will use find
    setupLedgerEntries([existingEntry]);

    const result = await topUp('user-1', 1000, 'test', 'admin', 'key-existing');
    expect(result.balanceCents).toBe(500);
  });

  it('throws ValidationError when daily risk limit would be exceeded', async () => {
    // daily usage = 18000, attempting 5000 → total 23000 > 20000 limit
    mockLedgerFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([makeLedgerEntry(18000, 'topup')]),
    });

    await expect(
      topUp('user-1', 5000, 'test', 'admin', 'key-limit')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('succeeds and returns new balance for a valid top-up', async () => {
    const insertedId = new ObjectId();
    mockLedgerInsertOne.mockResolvedValue({ insertedId });
    mockLedgerFindOne
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({ ...makeLedgerEntry(1000, 'topup'), _id: insertedId }); // appendEntry fetch

    const result = await topUp('user-1', 1000, 'Top-up', 'admin', 'key-new');
    expect(result.balanceCents).toBe(1000);
  });
});

// ── spend ─────────────────────────────────────────────────────────────────────

describe('spend()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLedgerFindOne.mockResolvedValue(null); // no idempotency hit
    mockLedgerInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
    mockMembershipUpdateOne.mockResolvedValue({});
  });

  it('throws ValidationError for zero amount', async () => {
    await expect(
      spend('user-1', 0, 'test', undefined, undefined, 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for non-integer amount', async () => {
    await expect(
      spend('user-1', 5.5, 'test', undefined, undefined, 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when balance is insufficient', async () => {
    // balance = 100, trying to spend 500
    setupLedgerEntries([makeLedgerEntry(100, 'topup')]);

    await expect(
      spend('user-1', 500, 'purchase', undefined, undefined, 'admin', 'key-spend')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns existing balance when idempotency key already exists', async () => {
    const existingEntry = { ...makeLedgerEntry(-300, 'spend'), _id: new ObjectId() };
    mockLedgerFindOne.mockResolvedValue(existingEntry);
    setupLedgerEntries([makeLedgerEntry(1000, 'topup'), existingEntry]);

    const result = await spend('user-1', 300, 'purchase', undefined, undefined, 'admin', 'key-dup');
    expect(result.balanceCents).toBe(700);
    expect(result.entryId).toBeDefined();
  });

  it('throws ValidationError when daily risk limit would be exceeded', async () => {
    setupLedgerEntries([
      makeLedgerEntry(15000, 'topup'),
      makeLedgerEntry(15000, 'topup'),
    ]);
    // daily usage > limit even before this spend

    await expect(
      spend('user-1', 1000, 'purchase', undefined, undefined, 'admin', 'key-risk')
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── refund ────────────────────────────────────────────────────────────────────

describe('refund()', () => {
  const originalEntryId = new ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
    mockLedgerFindOne.mockResolvedValue(null); // idempotency check
    mockLedgerInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
    mockMembershipUpdateOne.mockResolvedValue({});
    setupLedgerEntries([]);
  });

  it('throws ValidationError for zero amount', async () => {
    await expect(
      refund('user-1', 0, originalEntryId, 'test', 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for non-integer amount', async () => {
    await expect(
      refund('user-1', 1.5, originalEntryId, 'test', 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for an invalid ObjectId original entry', async () => {
    await expect(
      refund('user-1', 100, 'not-an-objectid', 'test', 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when the original ledger entry does not exist', async () => {
    mockLedgerFindOne
      .mockResolvedValueOnce(null)  // idempotency check
      .mockResolvedValueOnce(null); // original entry lookup

    await expect(
      refund('user-1', 100, originalEntryId, 'test', 'admin', 'key-refund')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when original entry type is points_deduction', async () => {
    mockLedgerFindOne
      .mockResolvedValueOnce(null)  // idempotency
      .mockResolvedValueOnce({ ...makeLedgerEntry(0, 'points_deduction'), _id: new ObjectId(originalEntryId) });

    await expect(
      refund('user-1', 100, originalEntryId, 'test', 'admin', 'key-bad-type')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns current balance when idempotency key already exists', async () => {
    const existingRefund = makeLedgerEntry(200, 'refund');
    mockLedgerFindOne.mockResolvedValue(existingRefund);
    setupLedgerEntries([existingRefund]);

    const result = await refund('user-1', 200, originalEntryId, 'dup', 'admin', 'key-dup');
    expect(result.balanceCents).toBe(200);
  });
});

// ── redeemPoints ──────────────────────────────────────────────────────────────

describe('redeemPoints()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLedgerFindOne.mockResolvedValue(null);
    mockLedgerInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
    mockMembershipUpdateOne.mockResolvedValue({});
    setupLedgerEntries([]);
    // getMembershipAccount returns 500 points by default
    mockGetMembershipAccount.mockResolvedValue({
      _id: 'acc-id',
      userId: 'user-1',
      pointsBalance: 500,
      walletBalanceCents: 0,
    });
  });

  it('throws ValidationError for zero points', async () => {
    await expect(
      redeemPoints('user-1', 0, 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for negative points', async () => {
    await expect(
      redeemPoints('user-1', -100, 'admin', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when points are not a multiple of POINTS_REDEMPTION_BLOCK (100)', async () => {
    await expect(
      redeemPoints('user-1', 150, 'admin', 'key-block')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when user has insufficient points', async () => {
    mockGetMembershipAccount.mockResolvedValue({
      pointsBalance: 50, // less than 100
    });

    await expect(
      redeemPoints('user-1', 100, 'admin', 'key-insuf')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns updated balances on successful redemption (100 points = 100 cents credit)', async () => {
    mockGetMembershipAccount.mockResolvedValue({
      pointsBalance: 200,
      walletBalanceCents: 0,
    });

    const result = await redeemPoints('user-1', 100, 'admin', 'key-ok');
    // 100 points / 100 block * 100 cents = 100 cents
    expect(result.balanceCents).toBe(100);
    expect(result.pointsBalance).toBe(100); // 200 - 100
  });

  it('returns existing state when idempotency key already exists', async () => {
    const existingEntry = makeLedgerEntry(0, 'points_deduction');
    mockLedgerFindOne.mockResolvedValue(existingEntry);
    setupLedgerEntries([]);

    const result = await redeemPoints('user-1', 100, 'admin', 'key-dup');
    // getMembershipAccount called → returns 500 points, 0 balance
    expect(result.pointsBalance).toBe(500);
  });
});

// ── awardPoints ───────────────────────────────────────────────────────────────

describe('awardPoints()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMembershipUpdateOne.mockResolvedValue({});
    mockGetMembershipAccount.mockResolvedValue({ userId: 'user-1', pointsBalance: 0 });
  });

  it('does nothing for zero cents', async () => {
    await awardPoints('user-1', 0);
    expect(mockMembershipUpdateOne).not.toHaveBeenCalled();
  });

  it('does nothing for less than 100 cents (0 points)', async () => {
    await awardPoints('user-1', 99);
    expect(mockMembershipUpdateOne).not.toHaveBeenCalled();
  });

  it('awards 1 point for exactly 100 cents', async () => {
    await awardPoints('user-1', 100);
    const call = mockMembershipUpdateOne.mock.calls[0];
    expect(call[1].$inc.pointsBalance).toBe(1);
  });

  it('awards 10 points for 1000 cents', async () => {
    await awardPoints('user-1', 1000);
    const call = mockMembershipUpdateOne.mock.calls[0];
    expect(call[1].$inc.pointsBalance).toBe(10);
  });

  it('floors partial points (350 cents → 3 points)', async () => {
    await awardPoints('user-1', 350);
    const call = mockMembershipUpdateOne.mock.calls[0];
    expect(call[1].$inc.pointsBalance).toBe(3);
  });
});
