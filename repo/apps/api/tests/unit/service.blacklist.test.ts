/**
 * Unit tests for services/blacklist.service.ts
 *
 * Tests cover:
 *   - isBlacklisted: returns false for non-blacklisted user
 *   - isBlacklisted: returns true for active blacklist with no expiry
 *   - isBlacklisted: auto-clears expired blacklist and returns false
 *   - checkAutoBlacklist: skips when already blacklisted
 *   - checkAutoBlacklist: applies blacklist when no-show threshold reached
 *   - checkAutoBlacklist: applies blacklist when dispute threshold reached
 *   - checkAutoBlacklist: does not blacklist when below both thresholds
 *   - manualBlacklist: throws ValidationError if reason is empty
 *   - manualBlacklist: throws ValidationError if user is already blacklisted
 *   - manualBlacklist: applies blacklist entry and updates membership account
 *   - clearBlacklist: throws ValidationError if user is not blacklisted
 *   - clearBlacklist: clears action and updates membership account
 *   - listBlacklistActions: filters and paginates correctly
 */

import './setup';

// ── mock DB + dependencies ────────────────────────────────────────────────────

const mockActionFindOne = jest.fn();
const mockActionInsertOne = jest.fn();
const mockActionUpdateOne = jest.fn();
const mockActionCountDocuments = jest.fn();
const mockActionFind = jest.fn();

const mockAccountUpdateOne = jest.fn();
const mockAccountFindOne = jest.fn();

const mockResCountDocuments = jest.fn();
const mockDisputeCountDocuments = jest.fn();

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'blacklist_actions') {
      return {
        findOne: mockActionFindOne,
        insertOne: mockActionInsertOne,
        updateOne: mockActionUpdateOne,
        countDocuments: mockActionCountDocuments,
        find: mockActionFind,
      };
    }
    if (name === 'membership_accounts') {
      return {
        findOne: mockAccountFindOne,
        updateOne: mockAccountUpdateOne,
      };
    }
    if (name === 'reservations') {
      return {
        countDocuments: mockResCountDocuments,
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      };
    }
    if (name === 'charge_disputes') {
      return {
        countDocuments: mockDisputeCountDocuments,
      };
    }
    return {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'fallback' }),
      updateOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
  },
}));

jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const mockGetMembershipAccount = jest.fn();
jest.mock('../../src/services/membership.service', () => ({
  getMembershipAccount: (...args: any[]) => mockGetMembershipAccount(...args),
}));

import {
  isBlacklisted,
  checkAutoBlacklist,
  manualBlacklist,
  clearBlacklist,
  listBlacklistActions,
} from '../../src/services/blacklist.service';
import { ValidationError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'acc-1',
    userId: 'user-1',
    isBlacklisted: false,
    pointsBalance: 0,
    walletBalanceCents: 0,
    version: 1,
    ...overrides,
  };
}

function buildFindChain(docs: unknown[] = []) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  };
}

// ── isBlacklisted ─────────────────────────────────────────────────────────────

describe('isBlacklisted()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false when user is not blacklisted', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    const result = await isBlacklisted('user-1');
    expect(result).toBe(false);
    expect(mockActionFindOne).not.toHaveBeenCalled();
  });

  it('returns true for an active blacklist with no expiry', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    mockActionFindOne.mockResolvedValue({
      userId: 'user-1',
      clearedAt: null,
      expiresAt: null,
    });
    const result = await isBlacklisted('user-1');
    expect(result).toBe(true);
  });

  it('returns true for an active blacklist with a future expiry date', async () => {
    const futureExpiry = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    mockActionFindOne.mockResolvedValue({
      _id: 'action-1',
      userId: 'user-1',
      clearedAt: null,
      expiresAt: futureExpiry,
    });
    const result = await isBlacklisted('user-1');
    expect(result).toBe(true);
  });

  it('auto-clears expired blacklist and returns false', async () => {
    const pastExpiry = new Date(Date.now() - 1000); // already expired
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    mockActionFindOne.mockResolvedValue({
      _id: 'action-1',
      userId: 'user-1',
      clearedAt: null,
      expiresAt: pastExpiry,
    });
    mockActionUpdateOne.mockResolvedValue({});
    mockAccountUpdateOne.mockResolvedValue({});

    const result = await isBlacklisted('user-1');
    expect(result).toBe(false);
    // Should have updated the action with clearedAt
    expect(mockActionUpdateOne).toHaveBeenCalledTimes(1);
    // Should have set isBlacklisted = false on membership account
    expect(mockAccountUpdateOne).toHaveBeenCalledTimes(1);
    const accountUpdate = mockAccountUpdateOne.mock.calls[0][1].$set;
    expect(accountUpdate.isBlacklisted).toBe(false);
  });
});

// ── checkAutoBlacklist ────────────────────────────────────────────────────────

describe('checkAutoBlacklist()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActionInsertOne.mockResolvedValue({ insertedId: 'action-new' });
    mockAccountUpdateOne.mockResolvedValue({});
  });

  it('does nothing when user is already blacklisted', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    await checkAutoBlacklist('user-1');
    expect(mockResCountDocuments).not.toHaveBeenCalled();
    expect(mockDisputeCountDocuments).not.toHaveBeenCalled();
  });

  it('blacklists user when no-show count reaches threshold (3)', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    mockResCountDocuments.mockResolvedValue(3); // BLACKLIST_NOSHOW_THRESHOLD = 3

    await checkAutoBlacklist('user-1');

    expect(mockActionInsertOne).toHaveBeenCalledTimes(1);
    const action = mockActionInsertOne.mock.calls[0][0];
    expect(action.triggeredBy).toBe('auto_noshow');
    expect(mockAccountUpdateOne).toHaveBeenCalledTimes(1);
    const accountUpdate = mockAccountUpdateOne.mock.calls[0][1].$set;
    expect(accountUpdate.isBlacklisted).toBe(true);
  });

  it('does not blacklist when no-show count is below threshold (2)', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    mockResCountDocuments.mockResolvedValue(2);  // below threshold of 3
    mockDisputeCountDocuments.mockResolvedValue(0); // no disputes either

    await checkAutoBlacklist('user-1');
    expect(mockActionInsertOne).not.toHaveBeenCalled();
  });

  it('blacklists user when dispute count reaches threshold (2)', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    mockResCountDocuments.mockResolvedValue(1); // below no-show threshold
    mockDisputeCountDocuments.mockResolvedValue(2); // BLACKLIST_DISPUTE_THRESHOLD = 2

    await checkAutoBlacklist('user-1');

    expect(mockActionInsertOne).toHaveBeenCalledTimes(1);
    const action = mockActionInsertOne.mock.calls[0][0];
    expect(action.triggeredBy).toBe('auto_dispute');
  });

  it('does not blacklist when dispute count is below threshold (1)', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    mockResCountDocuments.mockResolvedValue(0);
    mockDisputeCountDocuments.mockResolvedValue(1); // below threshold of 2

    await checkAutoBlacklist('user-1');
    expect(mockActionInsertOne).not.toHaveBeenCalled();
  });

  it('stops checking disputes when no-show threshold is already met', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    mockResCountDocuments.mockResolvedValue(5); // above no-show threshold

    await checkAutoBlacklist('user-1');

    // Should return early after no-show blacklist, dispute check not needed
    expect(mockDisputeCountDocuments).not.toHaveBeenCalled();
  });
});

// ── manualBlacklist ───────────────────────────────────────────────────────────

describe('manualBlacklist()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActionInsertOne.mockResolvedValue({ insertedId: 'action-manual' });
    mockAccountUpdateOne.mockResolvedValue({});
  });

  it('throws ValidationError when reason is empty', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    await expect(
      manualBlacklist('user-1', '', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when reason is whitespace only', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    await expect(
      manualBlacklist('user-1', '   ', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when user is already blacklisted', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    await expect(
      manualBlacklist('user-1', 'Repeated violations', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('inserts a blacklist action with triggeredBy=manual', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    await manualBlacklist('user-1', 'Repeated violations of terms', 'admin-1');

    expect(mockActionInsertOne).toHaveBeenCalledTimes(1);
    const action = mockActionInsertOne.mock.calls[0][0];
    expect(action.triggeredBy).toBe('manual');
    expect(action.performedByUserId).toBe('admin-1');
    expect(action.clearedAt).toBeNull();
  });

  it('sets isBlacklisted=true on the membership account', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    await manualBlacklist('user-1', 'Repeated violations of terms', 'admin-1');

    expect(mockAccountUpdateOne).toHaveBeenCalledTimes(1);
    const update = mockAccountUpdateOne.mock.calls[0][1].$set;
    expect(update.isBlacklisted).toBe(true);
  });

  it('accepts optional expiresAt date', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    const expiry = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await manualBlacklist('user-1', 'Temporary suspension reason text', 'admin-1', expiry);

    const action = mockActionInsertOne.mock.calls[0][0];
    expect(action.expiresAt).toBe(expiry);
  });
});

// ── clearBlacklist ────────────────────────────────────────────────────────────

describe('clearBlacklist()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActionUpdateOne.mockResolvedValue({});
    mockAccountUpdateOne.mockResolvedValue({});
  });

  it('throws ValidationError when user is not currently blacklisted', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: false }));
    await expect(
      clearBlacklist('user-1', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('clears the active blacklist action', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    await clearBlacklist('user-1', 'admin-1');

    expect(mockActionUpdateOne).toHaveBeenCalledTimes(1);
    const actionUpdate = mockActionUpdateOne.mock.calls[0][1].$set;
    expect(actionUpdate.clearedByUserId).toBe('admin-1');
    expect(actionUpdate.clearedAt).toBeInstanceOf(Date);
  });

  it('sets isBlacklisted=false on the membership account', async () => {
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    await clearBlacklist('user-1', 'admin-1');

    expect(mockAccountUpdateOne).toHaveBeenCalledTimes(1);
    const update = mockAccountUpdateOne.mock.calls[0][1].$set;
    expect(update.isBlacklisted).toBe(false);
  });

  it('writes an audit log on clear', async () => {
    const { writeAuditLog } = require('../../src/services/audit.service');
    mockGetMembershipAccount.mockResolvedValue(makeAccount({ isBlacklisted: true }));
    await clearBlacklist('user-1', 'admin-1');
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0].action).toBe('blacklist.clear');
  });
});

// ── listBlacklistActions ──────────────────────────────────────────────────────

describe('listBlacklistActions()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns actions and total', async () => {
    const docs = [
      { _id: 'a1', userId: 'user-1', triggeredBy: 'manual', clearedAt: null },
    ];
    mockActionCountDocuments.mockResolvedValue(1);
    mockActionFind.mockReturnValue(buildFindChain(docs));

    const result = await listBlacklistActions({}, 1, 10);
    expect(result.total).toBe(1);
    expect(result.actions).toHaveLength(1);
  });

  it('filters by userId', async () => {
    mockActionCountDocuments.mockResolvedValue(0);
    mockActionFind.mockReturnValue(buildFindChain([]));

    await listBlacklistActions({ userId: 'user-5' }, 1, 10);
    const query = mockActionCountDocuments.mock.calls[0][0];
    expect(query.userId).toBe('user-5');
  });

  it('filters by triggeredBy', async () => {
    mockActionCountDocuments.mockResolvedValue(0);
    mockActionFind.mockReturnValue(buildFindChain([]));

    await listBlacklistActions({ triggeredBy: 'auto_noshow' }, 1, 10);
    const query = mockActionCountDocuments.mock.calls[0][0];
    expect(query.triggeredBy).toBe('auto_noshow');
  });

  it('filters active=true (clearedAt: null)', async () => {
    mockActionCountDocuments.mockResolvedValue(0);
    mockActionFind.mockReturnValue(buildFindChain([]));

    await listBlacklistActions({ active: true }, 1, 10);
    const query = mockActionCountDocuments.mock.calls[0][0];
    expect(query.clearedAt).toBeNull();
  });

  it('filters active=false (clearedAt: { $ne: null })', async () => {
    mockActionCountDocuments.mockResolvedValue(0);
    mockActionFind.mockReturnValue(buildFindChain([]));

    await listBlacklistActions({ active: false }, 1, 10);
    const query = mockActionCountDocuments.mock.calls[0][0];
    expect(query.clearedAt).toEqual({ $ne: null });
  });

  it('paginates correctly', async () => {
    mockActionCountDocuments.mockResolvedValue(100);
    const chain = buildFindChain([]);
    mockActionFind.mockReturnValue(chain);

    await listBlacklistActions({}, 4, 5);
    expect(chain.skip).toHaveBeenCalledWith(15); // (4-1)*5
    expect(chain.limit).toHaveBeenCalledWith(5);
  });
});
