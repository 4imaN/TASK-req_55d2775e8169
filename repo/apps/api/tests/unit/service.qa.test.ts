/**
 * Unit tests for services/qa.service.ts
 *
 * Tests cover:
 *   - createThread: title/body length validation, eligibility check, content safety,
 *                   spam check, success inserts thread
 *   - createPost: body length validation, thread not found, thread not visible,
 *                 content safety, spam check, success inserts post and increments count
 *   - pinThread: role check, not found, success toggles isPinned
 *   - collapseThread: role check, not found, cannot collapse removed thread, success
 *   - listThreads: non-staff sees visible/collapsed only, staff sees all, pagination
 *   - getThread: not found, removed thread hidden from non-staff, visible to moderator
 *   - listPosts: thread not found, removed thread hidden from non-staff
 */

import './setup';

// ── mock DB + dependencies ────────────────────────────────────────────────────

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

jest.mock('../../src/services/contentSafety.service', () => ({
  checkSensitiveWords: jest.fn().mockResolvedValue({ blocked: false, words: [] }),
  checkSpamLimit: jest.fn().mockResolvedValue({ allowed: true }),
  recordPost: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/middleware/auth', () => ({
  hasRole: (roles: string[], role: string) => {
    const hierarchy: Record<string, string[]> = {
      moderator: ['moderator', 'administrator'],
    };
    return (hierarchy[role] || [role]).some((r: string) => roles.includes(r));
  },
}));

import { ObjectId } from 'mongodb';
import {
  createThread,
  createPost,
  pinThread,
  collapseThread,
  listThreads,
  getThread,
  listPosts,
} from '../../src/services/qa.service';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../../src/services/auth.service';
import {
  checkSensitiveWords,
  checkSpamLimit,
  recordPost,
} from '../../src/services/contentSafety.service';

const mockCheckSensitiveWords = checkSensitiveWords as jest.Mock;
const mockCheckSpamLimit = checkSpamLimit as jest.Mock;
const mockRecordPost = recordPost as jest.Mock;

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

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: 'author-1',
    roomId: 'room-1',
    title: 'How do I book a study room?',
    body: 'Can someone explain the booking process in detail?',
    state: 'visible',
    isPinned: false,
    postCount: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── createThread ──────────────────────────────────────────────────────────────

describe('createThread()', () => {
  beforeEach(() => {
    clearAllCollectionMocks();
    mockCheckSensitiveWords.mockResolvedValue({ blocked: false, words: [] });
    mockCheckSpamLimit.mockResolvedValue({ allowed: true });
    mockRecordPost.mockResolvedValue(undefined);
  });

  it('throws ValidationError when title is too short (< QUESTION_MIN_LENGTH=10)', async () => {
    await expect(
      createThread('user-1', 'room-1', 'Short', 'A body that is long enough to pass validation here')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when body is too short (< QUESTION_MIN_LENGTH=10)', async () => {
    await expect(
      createThread('user-1', 'room-1', 'A valid title for the question', 'Short')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when title exceeds max length (> 1000)', async () => {
    const longTitle = 'a'.repeat(1001);
    await expect(
      createThread('user-1', 'room-1', longTitle, 'A valid body that is long enough to pass validation here')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ForbiddenError when user has no checked_in or completed reservation', async () => {
    getOrCreateMock('reservations').findOne.mockResolvedValue(null);

    await expect(
      createThread('user-1', 'room-1', 'A valid title question here', 'A valid body question here for the thread')
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError when content contains prohibited words', async () => {
    getOrCreateMock('reservations').findOne.mockResolvedValue({ _id: new ObjectId() });
    mockCheckSensitiveWords.mockResolvedValue({ blocked: true, words: ['spam'] });

    await expect(
      createThread('user-1', 'room-1', 'A valid title question here', 'A valid body question here for thread')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws SpamLimitError when user is posting too frequently', async () => {
    getOrCreateMock('reservations').findOne.mockResolvedValue({ _id: new ObjectId() });
    mockCheckSensitiveWords.mockResolvedValue({ blocked: false, words: [] });
    mockCheckSpamLimit.mockResolvedValue({ allowed: false, nextAllowedAt: new Date() });

    await expect(
      createThread('user-1', 'room-1', 'A valid title question here', 'A valid body question here for thread')
    ).rejects.toMatchObject({ name: 'SpamLimitError' });
  });

  it('inserts thread and calls recordPost on success', async () => {
    getOrCreateMock('reservations').findOne.mockResolvedValue({ _id: new ObjectId() });
    const threadId = new ObjectId();
    getOrCreateMock('qa_threads').insertOne.mockResolvedValue({ insertedId: threadId });

    const result = await createThread(
      'user-1',
      'room-1',
      'How does the booking system work here?',
      'Can someone explain the detailed booking process steps?'
    );

    expect(getOrCreateMock('qa_threads').insertOne).toHaveBeenCalledTimes(1);
    const inserted = getOrCreateMock('qa_threads').insertOne.mock.calls[0][0];
    expect(inserted.state).toBe('visible');
    expect(inserted.isPinned).toBe(false);
    expect(inserted.postCount).toBe(0);
    expect(mockRecordPost).toHaveBeenCalledWith('user-1');
    expect(result._id).toBeDefined();
  });

  it('trims whitespace from title and body', async () => {
    getOrCreateMock('reservations').findOne.mockResolvedValue({ _id: new ObjectId() });
    getOrCreateMock('qa_threads').insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    await createThread(
      'user-1',
      'room-1',
      '  How does booking work here?  ',
      '  Please explain the whole process step by step.  '
    );

    const inserted = getOrCreateMock('qa_threads').insertOne.mock.calls[0][0];
    expect(inserted.title).toBe('How does booking work here?');
    expect(inserted.body).toBe('Please explain the whole process step by step.');
  });
});

// ── createPost ────────────────────────────────────────────────────────────────

describe('createPost()', () => {
  beforeEach(() => {
    clearAllCollectionMocks();
    mockCheckSensitiveWords.mockResolvedValue({ blocked: false, words: [] });
    mockCheckSpamLimit.mockResolvedValue({ allowed: true });
    mockRecordPost.mockResolvedValue(undefined);
  });

  it('throws ValidationError when body is empty (< ANSWER_MIN_LENGTH=1)', async () => {
    await expect(
      createPost('user-1', new ObjectId().toString(), '')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when body exceeds ANSWER_MAX_LENGTH=2000', async () => {
    const longBody = 'a'.repeat(2001);
    await expect(
      createPost('user-1', new ObjectId().toString(), longBody)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid thread ObjectId', async () => {
    await expect(
      createPost('user-1', 'not-a-valid-oid', 'A valid post body here')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when thread does not exist', async () => {
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(null);

    await expect(
      createPost('user-1', new ObjectId().toString(), 'A valid post body')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when thread state is not visible', async () => {
    const thread = makeThread({ state: 'removed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    await expect(
      createPost('user-1', thread._id.toString(), 'A valid post body')
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when thread is collapsed', async () => {
    const thread = makeThread({ state: 'collapsed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    await expect(
      createPost('user-1', thread._id.toString(), 'A valid post body')
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError when post contains prohibited words', async () => {
    const thread = makeThread({ state: 'visible' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    mockCheckSensitiveWords.mockResolvedValue({ blocked: true, words: ['scam'] });

    await expect(
      createPost('user-1', thread._id.toString(), 'This is a scam post body')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('inserts post, increments thread postCount, calls recordPost', async () => {
    const thread = makeThread({ state: 'visible' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_posts').insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    getOrCreateMock('qa_threads').updateOne.mockResolvedValue({});

    const result = await createPost('user-1', thread._id.toString(), 'Great answer to the question!');

    expect(getOrCreateMock('qa_posts').insertOne).toHaveBeenCalledTimes(1);
    const inserted = getOrCreateMock('qa_posts').insertOne.mock.calls[0][0];
    expect(inserted.threadId).toBe(thread._id.toString());
    expect(inserted.state).toBe('visible');

    // postCount increment
    expect(getOrCreateMock('qa_threads').updateOne).toHaveBeenCalledTimes(1);
    const updateCall = getOrCreateMock('qa_threads').updateOne.mock.calls[0][1];
    expect(updateCall.$inc.postCount).toBe(1);

    expect(mockRecordPost).toHaveBeenCalledWith('user-1');
    expect(result._id).toBeDefined();
  });
});

// ── pinThread ─────────────────────────────────────────────────────────────────

describe('pinThread()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ForbiddenError for non-moderator', async () => {
    await expect(
      pinThread(new ObjectId().toString(), true, 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when thread does not exist', async () => {
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(null);
    await expect(
      pinThread(new ObjectId().toString(), true, 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pins the thread and returns the updated document', async () => {
    const thread = makeThread({ isPinned: false });
    const updated = { ...thread, isPinned: true, version: 2 };
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_threads').findOneAndUpdate.mockResolvedValue(updated);

    const result = await pinThread(thread._id.toString(), true, 'mod-1', ['moderator']);
    expect(result.isPinned).toBe(true);
    const updateArg = getOrCreateMock('qa_threads').findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.isPinned).toBe(true);
  });

  it('unpins the thread when isPinned=false', async () => {
    const thread = makeThread({ isPinned: true });
    const updated = { ...thread, isPinned: false, version: 2 };
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_threads').findOneAndUpdate.mockResolvedValue(updated);

    await pinThread(thread._id.toString(), false, 'mod-1', ['moderator']);
    const updateArg = getOrCreateMock('qa_threads').findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.isPinned).toBe(false);
  });
});

// ── collapseThread ────────────────────────────────────────────────────────────

describe('collapseThread()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ForbiddenError for non-moderator', async () => {
    await expect(
      collapseThread(new ObjectId().toString(), 'user-1', ['member'])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when thread does not exist', async () => {
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(null);
    await expect(
      collapseThread(new ObjectId().toString(), 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when thread is already removed', async () => {
    const thread = makeThread({ state: 'removed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    await expect(
      collapseThread(thread._id.toString(), 'mod-1', ['moderator'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('collapses a visible thread', async () => {
    const thread = makeThread({ state: 'visible' });
    const updated = { ...thread, state: 'collapsed', version: 2 };
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_threads').findOneAndUpdate.mockResolvedValue(updated);

    const result = await collapseThread(thread._id.toString(), 'mod-1', ['moderator']);
    expect(result.state).toBe('collapsed');
    const updateArg = getOrCreateMock('qa_threads').findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.state).toBe('collapsed');
  });
});

// ── listThreads ───────────────────────────────────────────────────────────────

describe('listThreads()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('non-staff sees only visible/collapsed threads (not removed)', async () => {
    getOrCreateMock('qa_threads').countDocuments.mockResolvedValue(0);
    getOrCreateMock('qa_threads').find.mockReturnValue(buildFindChain([]));
    getOrCreateMock('users').find.mockReturnValue(buildFindChain([]));

    await listThreads('room-1', { isStaff: false }, 1, 10);
    const query = getOrCreateMock('qa_threads').countDocuments.mock.calls[0][0];
    // state should be a $in filter excluding removed
    expect(query.state).toEqual({ $in: ['visible', 'collapsed'] });
  });

  it('staff can see all states without state filter', async () => {
    getOrCreateMock('qa_threads').countDocuments.mockResolvedValue(0);
    getOrCreateMock('qa_threads').find.mockReturnValue(buildFindChain([]));
    getOrCreateMock('users').find.mockReturnValue(buildFindChain([]));

    await listThreads('room-1', { isStaff: true }, 1, 10);
    const query = getOrCreateMock('qa_threads').countDocuments.mock.calls[0][0];
    // No state filter for staff without explicit filter
    expect(query.state).toBeUndefined();
  });

  it('applies explicit state filter for staff', async () => {
    getOrCreateMock('qa_threads').countDocuments.mockResolvedValue(0);
    getOrCreateMock('qa_threads').find.mockReturnValue(buildFindChain([]));
    getOrCreateMock('users').find.mockReturnValue(buildFindChain([]));

    await listThreads('room-1', { isStaff: true, state: 'removed' }, 1, 10);
    const query = getOrCreateMock('qa_threads').countDocuments.mock.calls[0][0];
    expect(query.state).toBe('removed');
  });

  it('returns data with author info and total', async () => {
    const authorOid = new ObjectId();
    const thread = makeThread({ userId: authorOid.toString() });
    getOrCreateMock('qa_threads').countDocuments.mockResolvedValue(1);
    getOrCreateMock('qa_threads').find.mockReturnValue(buildFindChain([thread]));
    getOrCreateMock('users').find.mockReturnValue(
      buildFindChain([{ _id: authorOid, displayName: 'Alice', reputationTier: 'Trusted' }])
    );

    const result = await listThreads('room-1', { isStaff: false }, 1, 10);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });
});

// ── getThread ─────────────────────────────────────────────────────────────────

describe('getThread()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ValidationError for invalid thread ObjectId', async () => {
    await expect(getThread('not-a-valid-oid')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when thread does not exist', async () => {
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(null);
    await expect(getThread(new ObjectId().toString())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when thread is removed and user is not a moderator', async () => {
    const thread = makeThread({ state: 'removed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    await expect(getThread(thread._id.toString(), 'user-1', ['member'])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns removed thread for moderator', async () => {
    const thread = makeThread({ state: 'removed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    const result = await getThread(thread._id.toString(), 'mod-1', ['moderator']);
    expect(result.state).toBe('removed');
  });

  it('returns visible thread for any user', async () => {
    const thread = makeThread({ state: 'visible' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    const result = await getThread(thread._id.toString(), 'user-1', ['member']);
    expect(result.state).toBe('visible');
  });
});

// ── listPosts ─────────────────────────────────────────────────────────────────

describe('listPosts()', () => {
  beforeEach(() => clearAllCollectionMocks());

  it('throws ValidationError for invalid thread ObjectId', async () => {
    await expect(listPosts('not-valid', 1, 10)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when thread does not exist', async () => {
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(null);
    await expect(listPosts(new ObjectId().toString(), 1, 10)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when thread is removed and user is not moderator', async () => {
    const thread = makeThread({ state: 'removed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);

    await expect(
      listPosts(thread._id.toString(), 1, 10, 'user-1', ['member'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns posts for a visible thread with author info', async () => {
    const thread = makeThread({ state: 'visible' });
    const post = { _id: new ObjectId(), threadId: thread._id.toString(), userId: 'user-1', body: 'A great answer', state: 'visible' };
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_posts').countDocuments.mockResolvedValue(1);
    getOrCreateMock('qa_posts').find.mockReturnValue(buildFindChain([post]));
    getOrCreateMock('users').find.mockReturnValue(buildFindChain([]));

    const result = await listPosts(thread._id.toString(), 1, 10, 'user-1', ['member']);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it('paginates posts correctly', async () => {
    const thread = makeThread({ state: 'visible' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_posts').countDocuments.mockResolvedValue(30);
    const chain = buildFindChain([]);
    getOrCreateMock('qa_posts').find.mockReturnValue(chain);
    getOrCreateMock('users').find.mockReturnValue(buildFindChain([]));

    await listPosts(thread._id.toString(), 3, 5, 'user-1', ['member']);
    expect(chain.skip).toHaveBeenCalledWith(10); // (3-1)*5
    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it('allows moderator to see posts under removed thread', async () => {
    const thread = makeThread({ state: 'removed' });
    getOrCreateMock('qa_threads').findOne.mockResolvedValue(thread);
    getOrCreateMock('qa_posts').countDocuments.mockResolvedValue(0);
    getOrCreateMock('qa_posts').find.mockReturnValue(buildFindChain([]));
    getOrCreateMock('users').find.mockReturnValue(buildFindChain([]));

    await expect(
      listPosts(thread._id.toString(), 1, 10, 'mod-1', ['moderator'])
    ).resolves.toBeDefined();
  });
});
