/**
 * Unit tests for services/dispute.service.ts
 *
 * Tests cover:
 *   - createDispute: reason too short, invalid ledgerEntryId, entry not found
 *   - createDispute: idempotency – returns existing dispute on duplicate key
 *   - createDispute: ConflictError when open dispute already exists for entry
 *   - createDispute: success path inserts and returns dispute doc
 *   - updateDisputeStatus: invalid dispute ID, dispute not found
 *   - updateDisputeStatus: invalid transition throws ValidationError
 *   - updateDisputeStatus: successful transition, writes audit log
 *   - listDisputes: filter building and pagination
 *   - getDispute: invalid ID, not found, success
 */

import './setup';

// ── mock DB + dependencies ────────────────────────────────────────────────────

const mockDisputeFindOne = jest.fn();
const mockDisputeInsertOne = jest.fn();
const mockDisputeFindOneAndUpdate = jest.fn();
const mockDisputeCountDocuments = jest.fn();
const mockDisputeFind = jest.fn();

const mockLedgerFindOne = jest.fn();
const mockLedgerFind = jest.fn();

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'charge_disputes') {
      return {
        findOne: mockDisputeFindOne,
        insertOne: mockDisputeInsertOne,
        findOneAndUpdate: mockDisputeFindOneAndUpdate,
        countDocuments: mockDisputeCountDocuments,
        find: mockDisputeFind,
      };
    }
    if (name === 'ledger_entries') {
      return {
        findOne: mockLedgerFindOne,
        find: mockLedgerFind,
        insertOne: jest.fn(),
        updateOne: jest.fn(),
      };
    }
    // fallback (membership_accounts etc.)
    return {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'fallback-id' }),
      updateOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      }),
    };
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

jest.mock('../../src/services/blacklist.service', () => ({
  checkAutoBlacklist: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/wallet.service', () => ({
  refund: jest.fn().mockResolvedValue({ balanceCents: 0 }),
}));

jest.mock('../../src/services/membership.service', () => ({
  getMembershipAccount: jest.fn().mockResolvedValue({
    _id: 'acc-id',
    userId: 'user-1',
    pointsBalance: 0,
    walletBalanceCents: 0,
    isBlacklisted: false,
    version: 1,
  }),
}));

import { ObjectId } from 'mongodb';
import {
  createDispute,
  updateDisputeStatus,
  listDisputes,
  getDispute,
} from '../../src/services/dispute.service';
import { ValidationError, NotFoundError, ConflictError } from '../../src/services/auth.service';
import { writeAuditLog } from '../../src/services/audit.service';

const mockWriteAuditLog = writeAuditLog as jest.Mock;

// ── helpers ────────────────────────────────────────────────────────────────────

function makeDisputeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: 'user-1',
    ledgerEntryId: new ObjectId().toString(),
    reason: 'This charge is incorrect and should be reversed',
    status: 'open',
    resolvedByUserId: null,
    internalNotes: null,
    idempotencyKey: 'key-1',
    createdAt: new Date(),
    updatedAt: new Date(),
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

// ── createDispute ─────────────────────────────────────────────────────────────

describe('createDispute()', () => {
  const validLedgerEntryId = new ObjectId().toString();

  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError when reason is empty', async () => {
    await expect(
      createDispute('user-1', validLedgerEntryId, '', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when reason is shorter than 10 characters', async () => {
    await expect(
      createDispute('user-1', validLedgerEntryId, 'Too short', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns existing dispute when idempotency key already exists', async () => {
    const existing = makeDisputeDoc();
    mockDisputeFindOne.mockResolvedValue(existing);

    const result = await createDispute('user-1', validLedgerEntryId, 'This is a valid dispute reason', 'key-1');
    expect(result).toBe(existing);
    expect(mockDisputeInsertOne).not.toHaveBeenCalled();
  });

  it('throws ValidationError for an invalid ledger entry ObjectId', async () => {
    mockDisputeFindOne.mockResolvedValue(null); // no idempotency hit

    await expect(
      createDispute('user-1', 'not-a-valid-objectid', 'This is a valid dispute reason', 'key-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when ledger entry does not belong to user', async () => {
    mockDisputeFindOne.mockResolvedValue(null); // no idempotency hit
    mockLedgerFindOne.mockResolvedValue(null);   // entry not found

    await expect(
      createDispute('user-1', validLedgerEntryId, 'This is a valid dispute reason', 'key-1')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when an open dispute already exists for the entry', async () => {
    mockDisputeFindOne
      .mockResolvedValueOnce(null)                   // idempotency check
      .mockResolvedValueOnce(makeDisputeDoc());        // open dispute check
    mockLedgerFindOne.mockResolvedValue({ _id: new ObjectId(validLedgerEntryId), userId: 'user-1' });

    await expect(
      createDispute('user-1', validLedgerEntryId, 'This is a valid dispute reason', 'key-1')
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('inserts a new dispute and returns it on success', async () => {
    const newDispute = makeDisputeDoc();
    mockDisputeFindOne
      .mockResolvedValueOnce(null) // no idempotency hit
      .mockResolvedValueOnce(null) // no open dispute
      .mockResolvedValueOnce(newDispute); // fetch after insert
    mockLedgerFindOne.mockResolvedValue({ _id: new ObjectId(validLedgerEntryId), userId: 'user-1' });
    mockDisputeInsertOne.mockResolvedValue({ insertedId: newDispute._id });

    const result = await createDispute(
      'user-1',
      validLedgerEntryId,
      'This is a valid dispute reason here',
      'key-new'
    );
    expect(mockDisputeInsertOne).toHaveBeenCalledTimes(1);
    const inserted = mockDisputeInsertOne.mock.calls[0][0];
    expect(inserted.status).toBe('open');
    expect(inserted.userId).toBe('user-1');
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
  });

  it('trims whitespace from reason before inserting', async () => {
    const newDispute = makeDisputeDoc();
    mockDisputeFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(newDispute);
    mockLedgerFindOne.mockResolvedValue({ _id: new ObjectId(validLedgerEntryId), userId: 'user-1' });
    mockDisputeInsertOne.mockResolvedValue({ insertedId: newDispute._id });

    await createDispute('user-1', validLedgerEntryId, '  This is a valid dispute reason  ', 'key-trim');
    const inserted = mockDisputeInsertOne.mock.calls[0][0];
    expect(inserted.reason).toBe('This is a valid dispute reason');
  });
});

// ── updateDisputeStatus ───────────────────────────────────────────────────────

describe('updateDisputeStatus()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError for an invalid dispute ID', async () => {
    await expect(
      updateDisputeStatus('bad-id', 'under_review', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when dispute does not exist', async () => {
    mockDisputeFindOne.mockResolvedValue(null);
    await expect(
      updateDisputeStatus(new ObjectId().toString(), 'under_review', 'admin-1')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for an invalid state transition', async () => {
    // open → resolved_user is not allowed (must go through under_review)
    const dispute = makeDisputeDoc({ status: 'open' });
    mockDisputeFindOne.mockResolvedValue(dispute);

    await expect(
      updateDisputeStatus(dispute._id.toString(), 'resolved_user', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for an invalid transition from terminal state', async () => {
    // rejected → under_review is not a valid transition
    const dispute = makeDisputeDoc({ status: 'rejected' });
    mockDisputeFindOne.mockResolvedValue(dispute);

    await expect(
      updateDisputeStatus(dispute._id.toString(), 'under_review', 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('performs a valid transition and writes an audit log', async () => {
    const dispute = makeDisputeDoc({ status: 'open' });
    const updated = makeDisputeDoc({ status: 'under_review', version: 2 });
    mockDisputeFindOne.mockResolvedValue(dispute);
    mockDisputeFindOneAndUpdate.mockResolvedValue(updated);

    const result = await updateDisputeStatus(dispute._id.toString(), 'under_review', 'admin-1', 'Investigating');
    expect(result.status).toBe('under_review');
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][0].action).toBe('dispute.update_status');
  });

  it('does not issue a refund when resolved in house favor (resolved_house)', async () => {
    const { refund } = require('../../src/services/wallet.service');
    const dispute = makeDisputeDoc({ status: 'under_review' });
    const updated = makeDisputeDoc({ status: 'resolved_house', version: 2 });
    mockDisputeFindOne.mockResolvedValue(dispute);
    mockDisputeFindOneAndUpdate.mockResolvedValue(updated);

    await updateDisputeStatus(dispute._id.toString(), 'resolved_house', 'admin-1');
    expect(refund).not.toHaveBeenCalled();
  });

  it('issues a refund when resolved in user favor (resolved_user)', async () => {
    const { refund } = require('../../src/services/wallet.service');
    const ledgerOid = new ObjectId();
    const dispute = makeDisputeDoc({ status: 'under_review', ledgerEntryId: ledgerOid.toString() });
    const updated = makeDisputeDoc({ status: 'resolved_user', ledgerEntryId: ledgerOid.toString(), version: 2 });
    mockDisputeFindOne.mockResolvedValue(dispute);
    mockDisputeFindOneAndUpdate.mockResolvedValue(updated);
    mockLedgerFindOne.mockResolvedValue({ _id: ledgerOid, amountCents: -500 });

    await updateDisputeStatus(dispute._id.toString(), 'resolved_user', 'admin-1');
    expect(refund).toHaveBeenCalledTimes(1);
    // amount should be Math.abs(-500) = 500
    expect(refund.mock.calls[0][1]).toBe(500);
  });
});

// ── listDisputes ──────────────────────────────────────────────────────────────

describe('listDisputes()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns disputes and total', async () => {
    const docs = [makeDisputeDoc(), makeDisputeDoc()];
    mockDisputeCountDocuments.mockResolvedValue(2);
    mockDisputeFind.mockReturnValue(buildFindChain(docs));

    const result = await listDisputes({}, 1, 10);
    expect(result.total).toBe(2);
    expect(result.disputes).toHaveLength(2);
  });

  it('filters by userId', async () => {
    mockDisputeCountDocuments.mockResolvedValue(0);
    mockDisputeFind.mockReturnValue(buildFindChain([]));

    await listDisputes({ userId: 'user-5' }, 1, 10);
    const query = mockDisputeCountDocuments.mock.calls[0][0];
    expect(query.userId).toBe('user-5');
  });

  it('filters by status', async () => {
    mockDisputeCountDocuments.mockResolvedValue(0);
    mockDisputeFind.mockReturnValue(buildFindChain([]));

    await listDisputes({ status: 'open' }, 1, 10);
    const query = mockDisputeCountDocuments.mock.calls[0][0];
    expect(query.status).toBe('open');
  });

  it('applies date range filter to createdAt', async () => {
    mockDisputeCountDocuments.mockResolvedValue(0);
    mockDisputeFind.mockReturnValue(buildFindChain([]));

    const start = new Date('2025-01-01');
    const end = new Date('2025-12-31');
    await listDisputes({ startDate: start, endDate: end }, 1, 10);
    const query = mockDisputeCountDocuments.mock.calls[0][0];
    expect(query.createdAt).toEqual({ $gte: start, $lte: end });
  });

  it('paginates correctly', async () => {
    mockDisputeCountDocuments.mockResolvedValue(50);
    const chain = buildFindChain([]);
    mockDisputeFind.mockReturnValue(chain);

    await listDisputes({}, 2, 15);
    expect(chain.skip).toHaveBeenCalledWith(15); // (2-1)*15
    expect(chain.limit).toHaveBeenCalledWith(15);
  });
});

// ── getDispute ────────────────────────────────────────────────────────────────

describe('getDispute()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError for an invalid dispute ID', async () => {
    await expect(getDispute('not-valid')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when dispute does not exist', async () => {
    mockDisputeFindOne.mockResolvedValue(null);
    await expect(getDispute(new ObjectId().toString())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the dispute when found', async () => {
    const dispute = makeDisputeDoc({ status: 'under_review' });
    mockDisputeFindOne.mockResolvedValue(dispute);

    const result = await getDispute(dispute._id.toString());
    expect(result.status).toBe('under_review');
    expect(result.userId).toBe('user-1');
  });
});
