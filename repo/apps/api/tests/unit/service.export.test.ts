/**
 * Unit tests for services/export.service.ts
 *
 * Tests cover:
 *   - createExportJob: invalid export type throws ValidationError
 *   - createExportJob: inserts job, enqueues background job, returns job doc
 *   - processExportJob: invalid ID throws, not found throws
 *   - processExportJob: invalid transition throws (e.g., completed → running)
 *   - getExportJob: invalid ID throws, not found throws, valid returns job
 *   - listExportJobs: filters by userId and status, paginates
 */

import './setup';

// ── mock DB + dependencies ────────────────────────────────────────────────────

const mockExportFindOne = jest.fn();
const mockExportInsertOne = jest.fn();
const mockExportUpdateOne = jest.fn();
const mockExportCountDocuments = jest.fn();
const mockExportFind = jest.fn();

function exportJobsCollection() {
  return {
    findOne: mockExportFindOne,
    insertOne: mockExportInsertOne,
    updateOne: mockExportUpdateOne,
    countDocuments: mockExportCountDocuments,
    find: mockExportFind,
  };
}

// Generic collection fallback for reservations/leads/etc in generateCsv
const mockGenericFind = jest.fn();
function genericCollection() {
  return {
    find: mockGenericFind,
    findOne: jest.fn().mockResolvedValue(null),
    countDocuments: jest.fn().mockResolvedValue(0),
    insertOne: jest.fn(),
    updateOne: jest.fn(),
  };
}

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'export_jobs') return exportJobsCollection();
    return genericCollection();
  },
}));

jest.mock('../../src/services/jobQueue.service', () => ({
  enqueueJob: jest.fn().mockResolvedValue('bg-job-123'),
}));

jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// argon2 is a native addon that won't build in this environment – mock auth.service entirely
// so that the module graph never tries to load it.
jest.mock('../../src/services/auth.service', () => {
  class ValidationError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ValidationError'; }
  }
  class NotFoundError extends Error {
    constructor(msg: string) { super(msg); this.name = 'NotFoundError'; }
  }
  return { ValidationError, NotFoundError };
});

// Mock fs so processExportJob doesn't write to disk
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  createExportJob,
  processExportJob,
  getExportJob,
  listExportJobs,
} from '../../src/services/export.service';
import { ValidationError, NotFoundError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeJobDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    requestedByUserId: 'user-1',
    exportType: 'reservations',
    filters: {},
    status: 'queued',
    filePath: null,
    fileHash: null,
    errorMessage: null,
    jobId: 'bg-job-123',
    createdAt: new Date(),
    updatedAt: new Date(),
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

// ── createExportJob ───────────────────────────────────────────────────────────

describe('createExportJob()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError for an unknown export type', async () => {
    await expect(
      createExportJob('user-1', 'invalid_type' as any, {})
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts all valid export types without throwing', async () => {
    const validTypes = ['reservations', 'attendance', 'leads', 'ledger', 'analytics', 'policy_impact'];
    for (const type of validTypes) {
      jest.clearAllMocks();
      const id = new ObjectId();
      mockExportInsertOne.mockResolvedValue({ insertedId: id });
      mockExportUpdateOne.mockResolvedValue({});
      mockExportFindOne.mockResolvedValue(makeJobDoc({ exportType: type, _id: id }));
      await expect(createExportJob('user-1', type as any, {})).resolves.toBeDefined();
    }
  });

  it('inserts a job document with status queued', async () => {
    const id = new ObjectId();
    mockExportInsertOne.mockResolvedValue({ insertedId: id });
    mockExportUpdateOne.mockResolvedValue({});
    mockExportFindOne.mockResolvedValue(makeJobDoc({ _id: id }));

    await createExportJob('user-1', 'reservations', { startDate: '2025-01-01' });
    const inserted = mockExportInsertOne.mock.calls[0][0];
    expect(inserted.status).toBe('queued');
    expect(inserted.requestedByUserId).toBe('user-1');
    expect(inserted.exportType).toBe('reservations');
  });

  it('updates the job with the background job ID after enqueue', async () => {
    const id = new ObjectId();
    mockExportInsertOne.mockResolvedValue({ insertedId: id });
    mockExportUpdateOne.mockResolvedValue({});
    mockExportFindOne.mockResolvedValue(makeJobDoc({ _id: id }));

    await createExportJob('user-1', 'leads', {});
    expect(mockExportUpdateOne).toHaveBeenCalledTimes(1);
    const update = mockExportUpdateOne.mock.calls[0][1].$set;
    expect(update.jobId).toBe('bg-job-123');
  });

  it('returns the created job document', async () => {
    const id = new ObjectId();
    const job = makeJobDoc({ _id: id, exportType: 'ledger' });
    mockExportInsertOne.mockResolvedValue({ insertedId: id });
    mockExportUpdateOne.mockResolvedValue({});
    mockExportFindOne.mockResolvedValue(job);

    const result = await createExportJob('user-1', 'ledger', {});
    expect(result.exportType).toBe('ledger');
  });
});

// ── processExportJob ──────────────────────────────────────────────────────────

describe('processExportJob()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError for an invalid ObjectId', async () => {
    await expect(processExportJob('not-an-objectid')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when export job does not exist', async () => {
    mockExportFindOne.mockResolvedValue(null);
    await expect(processExportJob(new ObjectId().toString())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when transition from current status to running is not allowed', async () => {
    // completed status cannot transition to running per EXPORT_JOB_TRANSITIONS
    mockExportFindOne.mockResolvedValue(makeJobDoc({ status: 'completed' }));
    await expect(processExportJob(new ObjectId().toString())).rejects.toBeInstanceOf(ValidationError);
  });

  it('marks job as running then completed on success', async () => {
    const id = new ObjectId();
    const job = makeJobDoc({ _id: id, status: 'queued', exportType: 'leads', filters: {} });
    mockExportFindOne.mockResolvedValue(job);
    mockExportUpdateOne.mockResolvedValue({});
    // generateCsv will use getCollection for 'leads' → generic mock returns empty array
    mockGenericFind.mockReturnValue(buildFindChain([]));

    await processExportJob(id.toString());

    expect(mockExportUpdateOne).toHaveBeenCalledTimes(2);
    // First call: running
    expect(mockExportUpdateOne.mock.calls[0][1].$set.status).toBe('running');
    // Second call: completed
    expect(mockExportUpdateOne.mock.calls[1][1].$set.status).toBe('completed');
  });

  it('marks job as failed when an error occurs and rethrows', async () => {
    const id = new ObjectId();
    const job = makeJobDoc({ _id: id, status: 'queued', exportType: 'reservations', filters: {} });
    mockExportFindOne.mockResolvedValue(job);
    mockExportUpdateOne.mockResolvedValueOnce({}); // running

    // Make the csv generation throw
    mockGenericFind.mockImplementation(() => { throw new Error('DB failure'); });

    await expect(processExportJob(id.toString())).rejects.toThrow('DB failure');

    // Should still mark as failed
    const calls = mockExportUpdateOne.mock.calls;
    const failedCall = calls.find((c: any) => c[1]?.$set?.status === 'failed');
    expect(failedCall).toBeDefined();
  });
});

// ── getExportJob ──────────────────────────────────────────────────────────────

describe('getExportJob()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError for an invalid ObjectId', async () => {
    await expect(getExportJob('bad-id')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when job does not exist', async () => {
    mockExportFindOne.mockResolvedValue(null);
    await expect(getExportJob(new ObjectId().toString())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the job document when found', async () => {
    const job = makeJobDoc({ status: 'completed' });
    mockExportFindOne.mockResolvedValue(job);

    const result = await getExportJob(job._id.toString());
    expect(result.status).toBe('completed');
    expect(result.exportType).toBe('reservations');
  });
});

// ── listExportJobs ────────────────────────────────────────────────────────────

describe('listExportJobs()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns jobs and total for empty filters', async () => {
    const docs = [makeJobDoc(), makeJobDoc()];
    mockExportCountDocuments.mockResolvedValue(2);
    mockExportFind.mockReturnValue(buildFindChain(docs));

    const result = await listExportJobs({}, 1, 10);
    expect(result.total).toBe(2);
    expect(result.jobs).toHaveLength(2);
  });

  it('filters by userId', async () => {
    mockExportCountDocuments.mockResolvedValue(0);
    mockExportFind.mockReturnValue(buildFindChain([]));

    await listExportJobs({ userId: 'user-42' }, 1, 10);
    const query = mockExportCountDocuments.mock.calls[0][0];
    expect(query.requestedByUserId).toBe('user-42');
  });

  it('filters by status', async () => {
    mockExportCountDocuments.mockResolvedValue(0);
    mockExportFind.mockReturnValue(buildFindChain([]));

    await listExportJobs({ status: 'failed' }, 1, 10);
    const query = mockExportCountDocuments.mock.calls[0][0];
    expect(query.status).toBe('failed');
  });

  it('paginates with correct skip/limit', async () => {
    mockExportCountDocuments.mockResolvedValue(100);
    const chain = buildFindChain([]);
    mockExportFind.mockReturnValue(chain);

    await listExportJobs({}, 3, 5);
    expect(chain.skip).toHaveBeenCalledWith(10); // (3-1)*5
    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it('returns empty jobs array when none match', async () => {
    mockExportCountDocuments.mockResolvedValue(0);
    mockExportFind.mockReturnValue(buildFindChain([]));

    const result = await listExportJobs({ userId: 'unknown-user' }, 1, 10);
    expect(result.jobs).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
