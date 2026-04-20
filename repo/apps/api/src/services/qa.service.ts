import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from './auth.service';
import { checkSensitiveWords, checkSpamLimit, recordPost } from './contentSafety.service';
import { hasRole } from '../middleware/auth';
import {
  QUESTION_MIN_LENGTH,
  QUESTION_MAX_LENGTH,
  ANSWER_MIN_LENGTH,
  ANSWER_MAX_LENGTH,
} from '@studyroomops/shared-policy';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toOid(id: string, label: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new ValidationError(`Invalid ${label}`);
  }
}

function validateLength(text: string, min: number, max: number, label: string): string {
  const trimmed = (text || '').trim();
  if (trimmed.length < min) throw new ValidationError(`${label} must be at least ${min} characters`);
  if (trimmed.length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
  return trimmed;
}

async function runContentSafety(text: string, label: string): Promise<void> {
  const safety = await checkSensitiveWords(text);
  if (safety.blocked) {
    throw new ValidationError(
      `${label} contains prohibited content: ${safety.words.join(', ')}`
    );
  }
}

async function runSpamCheck(userId: string): Promise<void> {
  const result = await checkSpamLimit(userId);
  if (!result.allowed) {
    const err = new Error('Posting too frequently. Please try again later.') as any;
    err.name = 'SpamLimitError';
    err.nextAllowedAt = result.nextAllowedAt;
    throw err;
  }
}

// ── Create Thread ─────────────────────────────────────────────────────────────

export async function createThread(
  userId: string,
  roomId: string,
  title: string,
  body: string
): Promise<Record<string, unknown>> {
  const trimmedTitle = validateLength(title, QUESTION_MIN_LENGTH, QUESTION_MAX_LENGTH, 'Title');
  const trimmedBody = validateLength(body, QUESTION_MIN_LENGTH, QUESTION_MAX_LENGTH, 'Body');

  // User must have a checked_in or completed reservation for this room
  const reservations = getCollection('reservations');
  const eligibleReservation = await reservations.findOne({
    userId,
    roomId,
    status: { $in: ['checked_in', 'completed'] },
  });
  if (!eligibleReservation) {
    throw new ForbiddenError(
      'You must have a checked-in or completed reservation for this room to post a thread'
    );
  }

  await runContentSafety(trimmedTitle + ' ' + trimmedBody, 'Thread');
  await runSpamCheck(userId);

  const now = new Date();
  const doc = {
    userId,
    roomId,
    title: trimmedTitle,
    body: trimmedBody,
    state: 'visible',
    isPinned: false,
    postCount: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const threads = getCollection('qa_threads');
  const result = await threads.insertOne(doc as any);
  await recordPost(userId);

  return { ...doc, _id: result.insertedId.toString() };
}

// ── Create Post ───────────────────────────────────────────────────────────────

export async function createPost(
  userId: string,
  threadId: string,
  body: string
): Promise<Record<string, unknown>> {
  const trimmedBody = validateLength(body, ANSWER_MIN_LENGTH, ANSWER_MAX_LENGTH, 'Post body');

  const oid = toOid(threadId, 'thread id');
  const threads = getCollection('qa_threads');
  const thread = await threads.findOne({ _id: oid }) as any;
  if (!thread) throw new NotFoundError('Thread not found');
  if (thread.state !== 'visible') {
    throw new ForbiddenError('Cannot post to a thread that is not visible');
  }

  await runContentSafety(trimmedBody, 'Post');
  await runSpamCheck(userId);

  const now = new Date();
  const doc = {
    threadId,
    userId,
    body: trimmedBody,
    state: 'visible',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const posts = getCollection('qa_posts');
  const result = await posts.insertOne(doc as any);

  // Increment thread post count
  await threads.updateOne({ _id: oid }, { $inc: { postCount: 1 }, $set: { updatedAt: now } });

  await recordPost(userId);

  return { ...doc, _id: result.insertedId.toString() };
}

// ── Pin Thread ────────────────────────────────────────────────────────────────

export async function pinThread(
  threadId: string,
  isPinned: boolean,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const oid = toOid(threadId, 'thread id');
  const threads = getCollection('qa_threads');
  const thread = await threads.findOne({ _id: oid }) as any;
  if (!thread) throw new NotFoundError('Thread not found');

  const updated = await threads.findOneAndUpdate(
    { _id: oid },
    { $set: { isPinned, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );

  return updated as any;
}

// ── Collapse Thread ───────────────────────────────────────────────────────────

export async function collapseThread(
  threadId: string,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const oid = toOid(threadId, 'thread id');
  const threads = getCollection('qa_threads');
  const thread = await threads.findOne({ _id: oid }) as any;
  if (!thread) throw new NotFoundError('Thread not found');

  if (thread.state === 'removed') {
    throw new ValidationError('Cannot collapse a removed thread');
  }

  const updated = await threads.findOneAndUpdate(
    { _id: oid },
    { $set: { state: 'collapsed', updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );

  return updated as any;
}

// ── List Threads ──────────────────────────────────────────────────────────────

export async function listThreads(
  roomId: string,
  filters: { state?: string; isStaff?: boolean },
  page: number,
  pageSize: number
): Promise<{ data: unknown[]; total: number }> {
  const threads = getCollection('qa_threads');
  const query: Record<string, unknown> = { roomId };

  if (!filters.isStaff) {
    // Non-staff only see visible/collapsed
    query.state = filters.state && ['visible', 'collapsed'].includes(filters.state)
      ? filters.state
      : { $in: ['visible', 'collapsed'] };
  } else if (filters.state) {
    query.state = filters.state;
  }

  const total = await threads.countDocuments(query);
  const threadDocs = await threads
    .find(query)
    .sort({ isPinned: -1, createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as any[];

  // Batch-fetch author display data
  const authorIds = [...new Set(threadDocs.map((t: any) => t.userId))];
  const authorOids = authorIds.map((id) => { try { return new ObjectId(id); } catch { return null; } }).filter(Boolean) as ObjectId[];
  const authorDocs = authorOids.length > 0
    ? await getCollection('users')
        .find({ _id: { $in: authorOids } } as any, { projection: { _id: 1, displayName: 1, username: 1, reputationTier: 1 } })
        .toArray() as any[]
    : [];
  const authorMap = new Map<string, { _id: string; displayName: string; reputationTier?: string }>();
  for (const a of authorDocs) {
    authorMap.set(a._id.toString(), { _id: a._id.toString(), displayName: a.displayName || a.username, reputationTier: a.reputationTier });
  }

  const data = threadDocs.map((t: any) => ({
    ...t,
    author: authorMap.get(t.userId) || { _id: t.userId, displayName: 'Unknown' },
  }));

  return { data, total };
}

// ── Get Thread ────────────────────────────────────────────────────────────────

export async function getThread(
  threadId: string,
  userId?: string,
  userRoles?: string[]
): Promise<Record<string, unknown>> {
  const oid = toOid(threadId, 'thread id');
  const threads = getCollection('qa_threads');
  const thread = await threads.findOne({ _id: oid }) as any;
  if (!thread) throw new NotFoundError('Thread not found');

  const isModerator = userRoles ? hasRole(userRoles, 'moderator') : false;

  // Removed threads are only visible to moderators/admins
  if (thread.state === 'removed' && !isModerator) {
    throw new NotFoundError('Thread not found');
  }

  return thread;
}

// ── List Posts ────────────────────────────────────────────────────────────────

export async function listPosts(
  threadId: string,
  page: number,
  pageSize: number,
  userId?: string,
  userRoles?: string[]
): Promise<{ data: unknown[]; total: number }> {
  // Verify thread exists and is visible to the requester
  const oid = toOid(threadId, 'thread id');
  const threads = getCollection('qa_threads');
  const thread = await threads.findOne({ _id: oid }) as any;
  if (!thread) throw new NotFoundError('Thread not found');

  const isModerator = userRoles ? hasRole(userRoles, 'moderator') : false;

  // Posts under a removed thread are hidden from non-staff
  if (thread.state === 'removed' && !isModerator) {
    throw new NotFoundError('Thread not found');
  }

  const posts = getCollection('qa_posts');
  const query = { threadId };
  const total = await posts.countDocuments(query);
  const postDocs = await posts
    .find(query)
    .sort({ createdAt: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as any[];

  // Batch-fetch author display data
  const authorIds = [...new Set(postDocs.map((p: any) => p.userId))];
  const authorOids = authorIds.map((id) => { try { return new ObjectId(id); } catch { return null; } }).filter(Boolean) as ObjectId[];
  const authorDocs = authorOids.length > 0
    ? await getCollection('users')
        .find({ _id: { $in: authorOids } } as any, { projection: { _id: 1, displayName: 1, username: 1, reputationTier: 1 } })
        .toArray() as any[]
    : [];
  const authorMap = new Map<string, { _id: string; displayName: string; reputationTier?: string }>();
  for (const a of authorDocs) {
    authorMap.set(a._id.toString(), { _id: a._id.toString(), displayName: a.displayName || a.username, reputationTier: a.reputationTier });
  }

  const data = postDocs.map((p: any) => ({
    ...p,
    author: authorMap.get(p.userId) || { _id: p.userId, displayName: 'Unknown' },
  }));

  return { data, total };
}
