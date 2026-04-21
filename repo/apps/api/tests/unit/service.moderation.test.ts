/**
 * Unit tests for services/moderation.service.ts
 *
 * Tests cover:
 *   - changeContentState: role check, unknown content type, not found, invalid transition, success
 *   - createReport: short reason, content not found, duplicate open report, success
 *   - updateReportStatus: role check, not found, invalid transition, actioned → removes content
 *   - createAppeal: reason too short, content not found, not author, moderation action not found,
 *                   expired appeal window, duplicate open appeal, success
 *   - updateAppealStatus: role check, not found, invalid transition, accepted → restores content
 *   - listReports / listAppeals: role check, pagination
 */

import './setup';

// ── mock DB + dependencies ────────────────────────────────────────────────────

// Per-collection mock stores
const mockCollections: Record<string, Record<string, jest.Mock>> = {};

function getOrCreateMock(name: string) {
  if (!mockCollections[name]) {
    mockCollections[name] = {
      findOne: jest.fn(),
      find: jest.fn(),
      insertOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
    };
  }
  return mockCollections[name];
}

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => getOrCreateMock(name),
}));

jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/reputation.service', () => ({
  recomputeReputationForUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/middleware/auth', () => ({
  hasRole: (roles: string[], role: string) => {
    const hierarchy: Record<string, string[]> = {
      moderator: ['moderator', 'administrator'],
      administrator: ['administrator'],
    };
    return (hierarchy[role] || [role]).some((r: string) => roles.includes(r));
  },
}));

import { ObjectId } from 'mongodb';
import {
  changeContentState,
  createReport,
  updateReportStatus,
  createAppeal,
  updateAppealStatus,
  listReports,
  listAppeals,
} from '../../src/services/moderation.service';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../src/services/auth.service';

// ── helpers ────────────────────────────────────────────────────────────────────

function clearAllCollectionMocks() {
  for (const col of Object.values(mockCollections)) {
    for (const fn of Object.values(col)) {
      fn.mockReset();
    }
  }
}

function buildFindChain(docs: unknown[] = []) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  };
}

function makeReviewDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: 'author-1',
    state: 'visible',
    version: 1,
    moderationLocked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeReportDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    reporterUserId: 'reporter-1',
    contentType: 'review',
    contentId: new ObjectId().toString(),
    reason: 'Inappropriate content example',
    status: 'open',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeModActionDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    contentType: 'review',
    contentId: new ObjectId().toString(),
    moderatorUserId: 'mod-1',
    action: 'state_change',
    fromState: 'visible',
    toState: 'removed',
    createdAt: new Date(), // recent
    ...overrides,
  };
}

// ── changeContentState ────────────────────────────────────────────────────────

describe('changeContentState()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ForbiddenError when user lacks moderator role', async () => {
    await expect(
      changeContentState('review', new ObjectId().toString(), 'removed', 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError for unknown content type', async () => {
    await expect(
      changeContentState('unknown_type', new ObjectId().toString(), 'removed', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when content does not exist', async () => {
    getOrCreateMock('reviews').findOne.mockResolvedValue(null);
    await expect(
      changeContentState('review', new ObjectId().toString(), 'removed', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for invalid state transition', async () => {
    // removed → collapsed is not allowed
    const doc = makeReviewDoc({ state: 'removed' });
    getOrCreateMock('reviews').findOne.mockResolvedValue(doc);

    await expect(
      changeContentState('review', doc._id.toString(), 'collapsed', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('successfully transitions visible → removed and inserts moderation action', async () => {
    const doc = makeReviewDoc({ state: 'visible' });
    const updated = makeReviewDoc({ state: 'removed', version: 2 });
    getOrCreateMock('reviews').findOne.mockResolvedValue(doc);
    getOrCreateMock('reviews').findOneAndUpdate.mockResolvedValue(updated);
    getOrCreateMock('moderation_actions').insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const result = await changeContentState('review', doc._id.toString(), 'removed', 'mod-1', ['moderator']);
    expect(getOrCreateMock('moderation_actions').insertOne).toHaveBeenCalledTimes(1);
    const action = getOrCreateMock('moderation_actions').insertOne.mock.calls[0][0];
    expect(action.fromState).toBe('visible');
    expect(action.toState).toBe('removed');
  });

  it('accepts qa_thread and qa_post as valid content types', async () => {
    const threadDoc = { ...makeReviewDoc({ state: 'visible' }) };
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(threadDoc);
    getOrCreateMock('qa_threads').findOneAndUpdate.mockResolvedValue({ ...threadDoc, state: 'collapsed' });
    getOrCreateMock('moderation_actions').insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    await expect(
      changeContentState('qa_thread', threadDoc._id.toString(), 'collapsed', 'mod-1', ['moderator'])
    ).resolves.toBeDefined();
  });
});

// ── createReport ──────────────────────────────────────────────────────────────

describe('createReport()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ValidationError for unknown content type', async () => {
    await expect(
      createReport('reporter-1', 'unknown', new ObjectId().toString(), 'This is a reason')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when reason is too short (< 5 chars)', async () => {
    await expect(
      createReport('reporter-1', 'review', new ObjectId().toString(), 'Hi')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when content does not exist', async () => {
    getOrCreateMock('reviews').findOne.mockResolvedValue(null);

    await expect(
      createReport('reporter-1', 'review', new ObjectId().toString(), 'This post is spam content')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when an open report already exists for this content', async () => {
    const contentOid = new ObjectId();
    getOrCreateMock('reviews').findOne.mockResolvedValue(makeReviewDoc({ _id: contentOid }));
    getOrCreateMock('content_reports').findOne.mockResolvedValue(makeReportDoc({ status: 'open' }));

    await expect(
      createReport('reporter-1', 'review', contentOid.toString(), 'This is spam content here')
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('inserts a report and returns it on success', async () => {
    const contentOid = new ObjectId();
    getOrCreateMock('reviews').findOne.mockResolvedValue(makeReviewDoc({ _id: contentOid }));
    getOrCreateMock('content_reports').findOne.mockResolvedValue(null); // no open report
    getOrCreateMock('content_reports').insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const result = await createReport('reporter-1', 'review', contentOid.toString(), 'This content is inappropriate and harmful');
    expect(result).toHaveProperty('_id');
    expect(result.status).toBe('open');
    expect(result.contentType).toBe('review');
    expect(result.reason).toBe('This content is inappropriate and harmful');
  });

  it('trims whitespace from reason', async () => {
    const contentOid = new ObjectId();
    getOrCreateMock('reviews').findOne.mockResolvedValue(makeReviewDoc({ _id: contentOid }));
    getOrCreateMock('content_reports').findOne.mockResolvedValue(null);
    getOrCreateMock('content_reports').insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const result = await createReport('reporter-1', 'review', contentOid.toString(), '  Spam content report  ');
    expect(result.reason).toBe('Spam content report');
  });
});

// ── updateReportStatus ────────────────────────────────────────────────────────

describe('updateReportStatus()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ForbiddenError when user lacks moderator role', async () => {
    await expect(
      updateReportStatus(new ObjectId().toString(), 'under_review', 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when report does not exist', async () => {
    getOrCreateMock('content_reports').findOne.mockResolvedValue(null);
    await expect(
      updateReportStatus(new ObjectId().toString(), 'under_review', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for invalid state transition', async () => {
    const report = makeReportDoc({ status: 'actioned' }); // terminal
    getOrCreateMock('content_reports').findOne.mockResolvedValue(report);

    await expect(
      updateReportStatus(report._id.toString(), 'open', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('transitions report status successfully', async () => {
    const report = makeReportDoc({ status: 'open' });
    const updated = { ...report, status: 'under_review', version: 2 };
    getOrCreateMock('content_reports').findOne.mockResolvedValue(report);
    getOrCreateMock('content_reports').findOneAndUpdate.mockResolvedValue(updated);

    const result = await updateReportStatus(report._id.toString(), 'under_review', 'mod-1', ['moderator']);
    expect(result.status).toBe('under_review');
  });

  it('removes content when report status transitions to actioned', async () => {
    const contentOid = new ObjectId();
    const report = makeReportDoc({ status: 'under_review', contentId: contentOid.toString(), contentType: 'review' });
    const updatedReport = { ...report, status: 'actioned', version: 2 };
    getOrCreateMock('content_reports').findOne.mockResolvedValue(report);
    getOrCreateMock('content_reports').findOneAndUpdate.mockResolvedValue(updatedReport);

    // changeContentState calls will need reviews findOne + findOneAndUpdate + moderation_actions.insertOne
    const reviewDoc = makeReviewDoc({ _id: contentOid, state: 'visible', userId: 'author-1' });
    getOrCreateMock('reviews').findOne.mockResolvedValue(reviewDoc);
    getOrCreateMock('reviews').findOneAndUpdate.mockResolvedValue({ ...reviewDoc, state: 'removed' });
    getOrCreateMock('moderation_actions').insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    await updateReportStatus(report._id.toString(), 'actioned', 'mod-1', ['moderator']);

    // Verify that changeContentState was called (reviews.findOneAndUpdate with state=removed)
    const reviewUpdate = getOrCreateMock('reviews').findOneAndUpdate.mock.calls[0][1];
    expect(reviewUpdate.$set.state).toBe('removed');
  });
});

// ── createAppeal ──────────────────────────────────────────────────────────────

describe('createAppeal()', () => {
  beforeEach(() => clearAllCollectionMocks());

  const contentOid = new ObjectId();
  const modActionOid = new ObjectId();

  function setupBasicAppealMocks() {
    getOrCreateMock('reviews').findOne.mockResolvedValue(
      makeReviewDoc({ _id: contentOid, userId: 'author-1' })
    );
    getOrCreateMock('moderation_actions').findOne.mockResolvedValue(
      makeModActionDoc({
        _id: modActionOid,
        contentId: contentOid.toString(),
        contentType: 'review',
        createdAt: new Date(), // recent
      })
    );
    getOrCreateMock('content_appeals').findOne.mockResolvedValue(null); // no existing appeal
    getOrCreateMock('content_appeals').insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  }

  it('throws ValidationError when reason is too short', async () => {
    await expect(
      createAppeal('author-1', 'review', contentOid.toString(), modActionOid.toString(), 'No')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when content does not exist', async () => {
    getOrCreateMock('reviews').findOne.mockResolvedValue(null);
    await expect(
      createAppeal('author-1', 'review', contentOid.toString(), modActionOid.toString(), 'My review was fair and honest')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when appellant is not the content author', async () => {
    getOrCreateMock('reviews').findOne.mockResolvedValue(
      makeReviewDoc({ _id: contentOid, userId: 'other-user' })
    );
    getOrCreateMock('moderation_actions').findOne.mockResolvedValue(
      makeModActionDoc({ _id: modActionOid, contentId: contentOid.toString(), contentType: 'review' })
    );

    await expect(
      createAppeal('author-1', 'review', contentOid.toString(), modActionOid.toString(), 'My review was fair and correct')
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when moderation action does not exist', async () => {
    getOrCreateMock('reviews').findOne.mockResolvedValue(
      makeReviewDoc({ _id: contentOid, userId: 'author-1' })
    );
    getOrCreateMock('moderation_actions').findOne.mockResolvedValue(null);

    await expect(
      createAppeal('author-1', 'review', contentOid.toString(), modActionOid.toString(), 'My review was fair and accurate')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when appeal window has expired (> 7 days)', async () => {
    getOrCreateMock('reviews').findOne.mockResolvedValue(
      makeReviewDoc({ _id: contentOid, userId: 'author-1' })
    );
    // Action created 8 days ago, beyond APPEAL_WINDOW_DAYS = 7
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    getOrCreateMock('moderation_actions').findOne.mockResolvedValue(
      makeModActionDoc({
        _id: modActionOid,
        contentId: contentOid.toString(),
        contentType: 'review',
        createdAt: eightDaysAgo,
      })
    );

    await expect(
      createAppeal('author-1', 'review', contentOid.toString(), modActionOid.toString(), 'My review was fair and correct answer')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ConflictError when an open appeal already exists for this moderation action', async () => {
    setupBasicAppealMocks();
    getOrCreateMock('content_appeals').findOne.mockResolvedValue({ status: 'submitted' }); // existing open

    await expect(
      createAppeal('author-1', 'review', contentOid.toString(), modActionOid.toString(), 'This review was fair and correct and proper')
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('inserts an appeal with status submitted on success', async () => {
    setupBasicAppealMocks();

    const result = await createAppeal(
      'author-1',
      'review',
      contentOid.toString(),
      modActionOid.toString(),
      'My review was factual and well-written and correct'
    );

    expect(getOrCreateMock('content_appeals').insertOne).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('submitted');
    expect(result.appellantUserId).toBe('author-1');
  });
});

// ── updateAppealStatus ────────────────────────────────────────────────────────

describe('updateAppealStatus()', () => {
  beforeEach(() => clearAllCollectionMocks());

  function makeAppealDoc(overrides: Record<string, unknown> = {}) {
    const contentOid = new ObjectId();
    return {
      _id: new ObjectId(),
      appellantUserId: 'author-1',
      contentType: 'review',
      contentId: contentOid.toString(),
      moderationActionId: new ObjectId().toString(),
      reason: 'My review was fair',
      status: 'submitted',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('throws ForbiddenError for non-moderator', async () => {
    await expect(
      updateAppealStatus(new ObjectId().toString(), 'under_review', 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when appeal does not exist', async () => {
    getOrCreateMock('content_appeals').findOne.mockResolvedValue(null);
    await expect(
      updateAppealStatus(new ObjectId().toString(), 'under_review', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for invalid state transition', async () => {
    const appeal = makeAppealDoc({ status: 'accepted' }); // terminal
    getOrCreateMock('content_appeals').findOne.mockResolvedValue(appeal);

    await expect(
      updateAppealStatus(appeal._id.toString(), 'submitted', 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('transitions from submitted → under_review successfully', async () => {
    const appeal = makeAppealDoc({ status: 'submitted' });
    const updated = { ...appeal, status: 'under_review', version: 2 };
    getOrCreateMock('content_appeals').findOne.mockResolvedValue(appeal);
    getOrCreateMock('content_appeals').findOneAndUpdate.mockResolvedValue(updated);

    const result = await updateAppealStatus(appeal._id.toString(), 'under_review', 'mod-1', ['moderator']);
    expect(result.status).toBe('under_review');
  });

  it('restores content to visible when appeal is accepted', async () => {
    const contentOid = new ObjectId();
    const appeal = makeAppealDoc({ status: 'under_review', contentId: contentOid.toString(), contentType: 'review' });
    const updated = { ...appeal, status: 'accepted', version: 2 };
    getOrCreateMock('content_appeals').findOne.mockResolvedValue(appeal);
    getOrCreateMock('content_appeals').findOneAndUpdate.mockResolvedValue(updated);

    // For re-fetching content author after restoring
    const reviewDoc = makeReviewDoc({ _id: contentOid, userId: 'author-1', state: 'removed' });
    getOrCreateMock('reviews').updateOne.mockResolvedValue({});
    getOrCreateMock('reviews').findOne.mockResolvedValue(reviewDoc);

    await updateAppealStatus(appeal._id.toString(), 'accepted', 'mod-1', ['moderator']);

    expect(getOrCreateMock('reviews').updateOne).toHaveBeenCalledTimes(1);
    const updateCall = getOrCreateMock('reviews').updateOne.mock.calls[0][1];
    expect(updateCall.$set.state).toBe('visible');
    expect(updateCall.$set.moderationLocked).toBe(false);
  });
});

// ── listReports ───────────────────────────────────────────────────────────────

describe('listReports()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ForbiddenError for non-moderator', async () => {
    await expect(
      listReports({}, 1, 10, 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns data and total for moderator', async () => {
    const docs = [makeReportDoc(), makeReportDoc()];
    getOrCreateMock('content_reports').countDocuments.mockResolvedValue(2);
    getOrCreateMock('content_reports').find.mockReturnValue(buildFindChain(docs));

    const result = await listReports({}, 1, 10, 'mod-1', ['moderator']);
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it('filters by status', async () => {
    getOrCreateMock('content_reports').countDocuments.mockResolvedValue(0);
    getOrCreateMock('content_reports').find.mockReturnValue(buildFindChain([]));

    await listReports({ status: 'open' }, 1, 10, 'mod-1', ['moderator']);
    const query = getOrCreateMock('content_reports').countDocuments.mock.calls[0][0];
    expect(query.status).toBe('open');
  });
});

// ── listAppeals ───────────────────────────────────────────────────────────────

describe('listAppeals()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ForbiddenError for non-moderator', async () => {
    await expect(
      listAppeals({}, 1, 10, 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns data and total for moderator', async () => {
    const docs = [{ _id: new ObjectId(), status: 'submitted' }];
    getOrCreateMock('content_appeals').countDocuments.mockResolvedValue(1);
    getOrCreateMock('content_appeals').find.mockReturnValue(buildFindChain(docs));

    const result = await listAppeals({}, 1, 10, 'mod-1', ['moderator']);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it('filters by contentType', async () => {
    getOrCreateMock('content_appeals').countDocuments.mockResolvedValue(0);
    getOrCreateMock('content_appeals').find.mockReturnValue(buildFindChain([]));

    await listAppeals({ contentType: 'review' }, 1, 10, 'mod-1', ['moderator']);
    const query = getOrCreateMock('content_appeals').countDocuments.mock.calls[0][0];
    expect(query.contentType).toBe('review');
  });
});
