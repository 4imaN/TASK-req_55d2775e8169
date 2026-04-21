/**
 * Unit tests for services/lead.service.ts
 *
 * All MongoDB interactions are mocked.
 * Tests cover:
 *   - createLead: type validation, requirements, budget, phone, idempotency
 *   - updateLeadStatus: invalid transitions, admin-only reopen, required fields
 *   - addLeadNote: staff-only gate, content validation, visibility
 *   - getLeadById: ownership rules
 */

import './setup';

// ── mock DB ────────────────────────────────────────────────────────────────────

const mockLeadsFindOne = jest.fn();
const mockLeadsInsertOne = jest.fn();
const mockLeadsFindOneAndUpdate = jest.fn();
const mockLeadsFind = jest.fn();
const mockLeadsCountDocuments = jest.fn();
const mockHistoryInsertOne = jest.fn();
const mockHistoryFind = jest.fn();

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'leads') {
      return {
        findOne: mockLeadsFindOne,
        insertOne: mockLeadsInsertOne,
        findOneAndUpdate: mockLeadsFindOneAndUpdate,
        find: mockLeadsFind,
        countDocuments: mockLeadsCountDocuments,
      };
    }
    if (name === 'lead_status_history') {
      return {
        insertOne: mockHistoryInsertOne,
        find: mockHistoryFind,
      };
    }
    return { findOne: jest.fn(), insertOne: jest.fn() };
  },
}));

import { ObjectId } from 'mongodb';
import {
  createLead,
  updateLeadStatus,
  addLeadNote,
  getLeadById,
} from '../../src/services/lead.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

const userId = 'user-1';
const leadId = new ObjectId().toString();

function makeValidCreateData(overrides: Record<string, unknown> = {}) {
  return {
    type: 'group_study',
    requirements: 'Need a quiet room for 6 people with a whiteboard.',
    budgetCapCents: 5000,
    availabilityWindows: [
      {
        start: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        end: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
      },
    ],
    contactPhone: '+1 555-123-4567',
    ...overrides,
  };
}

function makeLeadDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(leadId),
    requesterUserId: userId,
    type: 'group_study',
    requirements: 'Need a quiet room for 6 people with a whiteboard.',
    budgetCapCents: 5000,
    availabilityWindows: [],
    contactPhone: '+15551234567',
    status: 'New',
    notes: [],
    idempotencyKey: 'ikey-1',
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

// ── createLead ────────────────────────────────────────────────────────────────

describe('createLead()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLeadsFindOne.mockResolvedValue(null); // no idempotency hit
    mockLeadsInsertOne.mockResolvedValue({ insertedId: new ObjectId(leadId) });
    mockHistoryInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it('throws ValidationError for an invalid lead type', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ type: 'unknown_type' }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when requirements is empty', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ requirements: '' }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when requirements is too short (< 10 chars)', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ requirements: 'Short' }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a negative budget', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ budgetCapCents: -100 }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a non-integer budget', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ budgetCapCents: 50.5 }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when availability windows is empty', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ availabilityWindows: [] }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when a window has start >= end', async () => {
    const now = new Date().toISOString();
    await expect(
      createLead(userId, makeValidCreateData({
        availabilityWindows: [{ start: now, end: now }],
      }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for an invalid phone number', async () => {
    await expect(
      createLead(userId, makeValidCreateData({ contactPhone: 'abc' }), 'ikey-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns existing lead when idempotency key matches', async () => {
    const existing = makeLeadDoc();
    mockLeadsFindOne.mockResolvedValue(existing);

    const result = await createLead(userId, makeValidCreateData(), 'ikey-existing');
    expect(result.status).toBe('New');
  });

  it('creates a lead successfully with valid data', async () => {
    const result = await createLead(userId, makeValidCreateData(), 'ikey-new');

    expect(result.type).toBe('group_study');
    expect(result.status).toBe('New');
    expect(mockLeadsInsertOne).toHaveBeenCalledTimes(1);
    expect(mockHistoryInsertOne).toHaveBeenCalledTimes(1);
  });

  it('normalizes phone number on creation', async () => {
    const result = await createLead(userId, makeValidCreateData({ contactPhone: '+1 (555) 123-4567' }), 'ikey-phone');
    // normalizePhone strips non-digit/+ chars
    expect(result.contactPhone).toBe('+15551234567');
  });

  it('accepts zero budget', async () => {
    const result = await createLead(userId, makeValidCreateData({ budgetCapCents: 0 }), 'ikey-zero-budget');
    expect(result.budgetCapCents).toBe(0);
  });

  it('creates a long_term type lead', async () => {
    const result = await createLead(userId, makeValidCreateData({ type: 'long_term' }), 'ikey-lt');
    expect(result.type).toBe('long_term');
  });
});

// ── updateLeadStatus ──────────────────────────────────────────────────────────

describe('updateLeadStatus()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc());
    mockLeadsFindOneAndUpdate.mockResolvedValue(makeLeadDoc({ status: 'In Discussion' }));
    mockHistoryInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it('throws ValidationError for an unrecognized status', async () => {
    await expect(
      updateLeadStatus(leadId, 'Invalid', userId, ['creator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when lead does not exist', async () => {
    mockLeadsFindOne.mockResolvedValue(null);
    await expect(
      updateLeadStatus(leadId, 'In Discussion', userId, ['creator'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for a disallowed transition (New → Confirmed)', async () => {
    await expect(
      updateLeadStatus(leadId, 'Confirmed', userId, ['creator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows New → In Discussion', async () => {
    const result = await updateLeadStatus(leadId, 'In Discussion', userId, ['creator']);
    expect(result.status).toBe('In Discussion');
  });

  it('throws ForbiddenError when non-admin tries to reopen a Closed lead', async () => {
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc({ status: 'Closed' }));
    await expect(
      updateLeadStatus(leadId, 'In Discussion', userId, ['creator'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows admin to reopen a Closed lead', async () => {
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc({ status: 'Closed' }));
    mockLeadsFindOneAndUpdate.mockResolvedValue(makeLeadDoc({ status: 'In Discussion' }));

    const result = await updateLeadStatus(leadId, 'In Discussion', userId, ['administrator']);
    expect(result.status).toBe('In Discussion');
  });

  it('requires quoteAmountCents when setting status to Quoted', async () => {
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc({ status: 'In Discussion' }));
    await expect(
      updateLeadStatus(leadId, 'Quoted', userId, ['creator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires quoteAmountCents when setting status to Confirmed', async () => {
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc({ status: 'Quoted' }));
    await expect(
      updateLeadStatus(leadId, 'Confirmed', userId, ['creator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires closeReason when closing a lead', async () => {
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc({ status: 'In Discussion' }));
    await expect(
      updateLeadStatus(leadId, 'Closed', userId, ['creator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a non-integer quoteAmountCents', async () => {
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc({ status: 'In Discussion' }));
    await expect(
      updateLeadStatus(leadId, 'Quoted', userId, ['creator'], 50.5)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ConflictError when findOneAndUpdate returns null (version conflict)', async () => {
    mockLeadsFindOneAndUpdate.mockResolvedValue(null);
    await expect(
      updateLeadStatus(leadId, 'In Discussion', userId, ['creator'])
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ── addLeadNote ────────────────────────────────────────────────────────────────

describe('addLeadNote()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc());
    mockLeadsFindOneAndUpdate.mockResolvedValue(
      makeLeadDoc({ notes: [{ noteId: 'n1', authorUserId: userId, content: 'Follow-up required.', isInternal: true, createdAt: new Date() }] })
    );
  });

  it('throws ForbiddenError when a regular member tries to add a note', async () => {
    await expect(
      addLeadNote(leadId, userId, ['member'], 'Some internal note.')
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError when note content is empty', async () => {
    await expect(
      addLeadNote(leadId, userId, ['creator'], '')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when lead does not exist', async () => {
    mockLeadsFindOne.mockResolvedValue(null);
    await expect(
      addLeadNote(leadId, userId, ['creator'], 'A valid note content here.')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('allows a creator to add a note', async () => {
    const result = await addLeadNote(leadId, userId, ['creator'], 'Follow-up required.');
    expect(Array.isArray(result.notes)).toBe(true);
    expect((result.notes as any[]).length).toBeGreaterThanOrEqual(1);
  });

  it('allows an administrator to add a note', async () => {
    const result = await addLeadNote(leadId, userId, ['administrator'], 'Admin note here.');
    expect(Array.isArray(result.notes)).toBe(true);
  });

  it('marks added notes as isInternal: true', async () => {
    const noteDoc = makeLeadDoc({
      notes: [{ noteId: 'n1', authorUserId: userId, content: 'Internal note', isInternal: true, createdAt: new Date() }],
    });
    mockLeadsFindOneAndUpdate.mockResolvedValue(noteDoc);

    const result = await addLeadNote(leadId, userId, ['creator'], 'Internal note');
    const notes = result.notes as any[];
    expect(notes[0].isInternal).toBe(true);
  });
});

// ── getLeadById ────────────────────────────────────────────────────────────────

describe('getLeadById()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLeadsFindOne.mockResolvedValue(makeLeadDoc());
  });

  it('throws NotFoundError for an invalid ObjectId', async () => {
    await expect(
      getLeadById('not-an-oid', userId, ['member'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when lead does not exist', async () => {
    mockLeadsFindOne.mockResolvedValue(null);
    await expect(
      getLeadById(leadId, userId, ['member'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the lead to its owner', async () => {
    const result = await getLeadById(leadId, userId, ['member']);
    expect(result.requesterUserId).toBe(userId);
  });

  it('throws ForbiddenError when a non-owner non-staff user requests the lead', async () => {
    await expect(
      getLeadById(leadId, 'other-user', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the lead to a creator (staff)', async () => {
    const result = await getLeadById(leadId, 'staff-user', ['creator']);
    expect(result.type).toBe('group_study');
  });

  it('hides internal notes from the lead requester', async () => {
    const leadWithNotes = makeLeadDoc({
      notes: [
        { noteId: 'n1', authorUserId: 'staff', content: 'Internal note', isInternal: true, createdAt: new Date() },
        { noteId: 'n2', authorUserId: 'staff', content: 'Public note', isInternal: false, createdAt: new Date() },
      ],
    });
    mockLeadsFindOne.mockResolvedValue(leadWithNotes);

    const result = await getLeadById(leadId, userId, ['member']);
    const notes = result.notes as any[];
    expect(notes.every((n: any) => !n.isInternal)).toBe(true);
    expect(notes).toHaveLength(1);
  });

  it('exposes internal notes to staff', async () => {
    const leadWithNotes = makeLeadDoc({
      notes: [
        { noteId: 'n1', authorUserId: 'staff', content: 'Internal note', isInternal: true, createdAt: new Date() },
        { noteId: 'n2', authorUserId: 'staff', content: 'Public note', isInternal: false, createdAt: new Date() },
      ],
    });
    mockLeadsFindOne.mockResolvedValue(leadWithNotes);

    const result = await getLeadById(leadId, 'staff-user', ['creator']);
    const notes = result.notes as any[];
    expect(notes).toHaveLength(2);
  });
});
