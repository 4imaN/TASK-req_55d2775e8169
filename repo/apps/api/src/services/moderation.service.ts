import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from './auth.service';
import { writeAuditLog } from './audit.service';
import { hasRole } from '../middleware/auth';
import {
  CONTENT_STATE_TRANSITIONS,
  REPORT_STATE_TRANSITIONS,
  APPEAL_STATE_TRANSITIONS,
  APPEAL_WINDOW_DAYS,
} from '@studyroomops/shared-policy';
import { recomputeReputationForUser } from './reputation.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toOid(id: string, label: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new ValidationError(`Invalid ${label}`);
  }
}

/** Maps contentType to its MongoDB collection name */
function contentCollection(contentType: string): string {
  switch (contentType) {
    case 'review': return 'reviews';
    case 'qa_thread': return 'qa_threads';
    case 'qa_post': return 'qa_posts';
    default: throw new ValidationError(`Unknown content type: ${contentType}`);
  }
}

// ── Change Content State ──────────────────────────────────────────────────────

export async function changeContentState(
  contentType: string,
  contentId: string,
  newState: string,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const collName = contentCollection(contentType);
  const oid = toOid(contentId, 'content id');
  const col = getCollection(collName);

  const doc = await col.findOne({ _id: oid }) as any;
  if (!doc) throw new NotFoundError(`${contentType} not found`);

  const currentState: string = doc.state;
  const allowed = (CONTENT_STATE_TRANSITIONS[currentState] || []);
  if (!allowed.includes(newState)) {
    throw new ValidationError(
      `Cannot transition ${contentType} from '${currentState}' to '${newState}'`
    );
  }

  const now = new Date();
  const updated = await col.findOneAndUpdate(
    { _id: oid },
    {
      $set: { state: newState, moderationLocked: true, updatedAt: now },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  ) as any;

  // Record moderation action
  const moderationActions = getCollection('moderation_actions');
  const actionResult = await moderationActions.insertOne({
    contentType,
    contentId,
    moderatorUserId: userId,
    action: 'state_change',
    fromState: currentState,
    toState: newState,
    createdAt: now,
  } as any);

  await writeAuditLog({
    actorUserId: userId,
    actorRole: userRoles.includes('administrator') ? 'administrator' : 'moderator',
    action: `${contentType}.state_change`,
    objectType: contentType,
    objectId: contentId,
    oldValue: { state: currentState },
    newValue: { state: newState },
    requestId: '',
  });

  // Async reputation recompute for content author
  if (doc.userId) {
    recomputeReputationForUser(doc.userId).catch(() => { /* fire-and-forget */ });
  }

  return { ...updated, moderationActionId: actionResult.insertedId.toString() };
}

// ── Create Report ─────────────────────────────────────────────────────────────

export async function createReport(
  reporterUserId: string,
  contentType: string,
  contentId: string,
  reason: string
): Promise<Record<string, unknown>> {
  // Validate content type
  const collName = contentCollection(contentType);

  if (!reason || reason.trim().length < 5) {
    throw new ValidationError('Report reason must be at least 5 characters');
  }

  // Verify content exists
  const contentCol = getCollection(collName);
  const contentOid = toOid(contentId, 'content id');
  const contentDoc = await contentCol.findOne({ _id: contentOid });
  if (!contentDoc) {
    throw new NotFoundError(`${contentType} not found`);
  }

  const reports = getCollection('content_reports');

  // One open report per reporter per content item
  const existingOpen = await reports.findOne({
    reporterUserId,
    contentType,
    contentId,
    status: { $in: ['open', 'under_review'] },
  });
  if (existingOpen) {
    throw new ConflictError('You already have an open report for this content');
  }

  const now = new Date();
  const doc = {
    reporterUserId,
    contentType,
    contentId,
    reason: reason.trim(),
    status: 'open',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await reports.insertOne(doc as any);
  return { ...doc, _id: result.insertedId.toString() };
}

// ── Update Report Status ──────────────────────────────────────────────────────

export async function updateReportStatus(
  reportId: string,
  newStatus: string,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const oid = toOid(reportId, 'report id');
  const reports = getCollection('content_reports');
  const report = await reports.findOne({ _id: oid }) as any;
  if (!report) throw new NotFoundError('Report not found');

  const currentStatus: string = report.status;
  const allowed = REPORT_STATE_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(
      `Cannot transition report from '${currentStatus}' to '${newStatus}'`
    );
  }

  const now = new Date();
  const updated = await reports.findOneAndUpdate(
    { _id: oid },
    {
      $set: { status: newStatus, reviewedByUserId: userId, updatedAt: now },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  ) as any;

  // On 'actioned', change content state to 'removed'
  if (newStatus === 'actioned') {
    await changeContentState(
      report.contentType,
      report.contentId,
      'removed',
      userId,
      userRoles
    );
  }

  await writeAuditLog({
    actorUserId: userId,
    actorRole: userRoles.includes('administrator') ? 'administrator' : 'moderator',
    action: 'report.status_change',
    objectType: 'content_report',
    objectId: reportId,
    oldValue: { status: currentStatus },
    newValue: { status: newStatus },
    requestId: '',
  });

  return updated;
}

// ── Create Appeal ─────────────────────────────────────────────────────────────

export async function createAppeal(
  appellantUserId: string,
  contentType: string,
  contentId: string,
  moderationActionId: string,
  reason: string
): Promise<Record<string, unknown>> {
  contentCollection(contentType); // validate type

  if (!reason || reason.trim().length < 5) {
    throw new ValidationError('Appeal reason must be at least 5 characters');
  }

  // Verify content exists and the appellant is the author
  const collName = contentCollection(contentType);
  const contentOid = toOid(contentId, 'content id');
  const col = getCollection(collName);
  const content = await col.findOne({ _id: contentOid }) as any;
  if (!content) throw new NotFoundError(`${contentType} not found`);
  if (content.userId !== appellantUserId) {
    throw new ForbiddenError('You can only appeal moderation actions on your own content');
  }

  // Verify moderation action exists and is within appeal window
  const modActions = getCollection('moderation_actions');
  const modActionOid = toOid(moderationActionId, 'moderation action id');
  const modAction = await modActions.findOne({ _id: modActionOid }) as any;
  if (!modAction) throw new NotFoundError('Moderation action not found');

  // Verify the moderation action matches the appeal's contentType and contentId
  if (modAction.contentType !== contentType || modAction.contentId !== contentId) {
    throw new ValidationError(
      'Moderation action does not match the specified content type and content id'
    );
  }

  const appealWindowMs = APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(modAction.createdAt).getTime() > appealWindowMs) {
    throw new ValidationError(
      `Appeal window has expired. Appeals must be submitted within ${APPEAL_WINDOW_DAYS} days of the moderation action`
    );
  }

  const appeals = getCollection('content_appeals');

  // One open appeal per moderation action
  const existingOpen = await appeals.findOne({
    moderationActionId,
    status: { $in: ['submitted', 'under_review'] },
  });
  if (existingOpen) {
    throw new ConflictError('An open appeal for this moderation action already exists');
  }

  const now = new Date();
  const doc = {
    appellantUserId,
    contentType,
    contentId,
    moderationActionId,
    reason: reason.trim(),
    status: 'submitted',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await appeals.insertOne(doc as any);
  return { ...doc, _id: result.insertedId.toString() };
}

// ── Update Appeal Status ──────────────────────────────────────────────────────

export async function updateAppealStatus(
  appealId: string,
  newStatus: string,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const oid = toOid(appealId, 'appeal id');
  const appeals = getCollection('content_appeals');
  const appeal = await appeals.findOne({ _id: oid }) as any;
  if (!appeal) throw new NotFoundError('Appeal not found');

  const currentStatus: string = appeal.status;
  const allowed = APPEAL_STATE_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(
      `Cannot transition appeal from '${currentStatus}' to '${newStatus}'`
    );
  }

  const now = new Date();
  const updated = await appeals.findOneAndUpdate(
    { _id: oid },
    {
      $set: { status: newStatus, reviewedByUserId: userId, updatedAt: now },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  ) as any;

  // On 'accepted', restore content to 'visible'
  if (newStatus === 'accepted') {
    const collName = contentCollection(appeal.contentType);
    const contentOid = toOid(appeal.contentId, 'content id');
    const col = getCollection(collName);
    await col.updateOne(
      { _id: contentOid },
      { $set: { state: 'visible', moderationLocked: false, updatedAt: now }, $inc: { version: 1 } }
    );

    // Recompute reputation for the content author
    const content = await col.findOne({ _id: contentOid }) as any;
    if (content?.userId) {
      recomputeReputationForUser(content.userId).catch(() => { /* fire-and-forget */ });
    }
  }

  await writeAuditLog({
    actorUserId: userId,
    actorRole: userRoles.includes('administrator') ? 'administrator' : 'moderator',
    action: 'appeal.status_change',
    objectType: 'content_appeal',
    objectId: appealId,
    oldValue: { status: currentStatus },
    newValue: { status: newStatus },
    requestId: '',
  });

  return updated;
}

// ── List Reports ──────────────────────────────────────────────────────────────

export async function listReports(
  filters: { status?: string; contentType?: string },
  page: number,
  pageSize: number,
  userId: string,
  userRoles: string[]
): Promise<{ data: unknown[]; total: number }> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const reports = getCollection('content_reports');
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.contentType) query.contentType = filters.contentType;

  const total = await reports.countDocuments(query);
  const data = await reports
    .find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  return { data, total };
}

// ── List Appeals ──────────────────────────────────────────────────────────────

export async function listAppeals(
  filters: { status?: string; contentType?: string },
  page: number,
  pageSize: number,
  userId: string,
  userRoles: string[]
): Promise<{ data: unknown[]; total: number }> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const appeals = getCollection('content_appeals');
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.contentType) query.contentType = filters.contentType;

  const total = await appeals.countDocuments(query);
  const data = await appeals
    .find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  return { data, total };
}
