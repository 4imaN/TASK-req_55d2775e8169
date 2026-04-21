/**
 * E2E — Moderation Flow
 *
 * Validates the complete moderation lifecycle as the React frontend
 * experiences it:
 *   Submit report → List reports (moderator) →
 *   Transition report status (submitted → under_review → actioned) →
 *   Appeal a moderation action → Process appeal (accept/reject)
 *
 * Mirrors ModerationPage.tsx contract:
 *   POST /api/v1/moderation/reports
 *   GET  /api/v1/moderation/reports
 *   PUT  /api/v1/moderation/reports/:id
 *   POST /api/v1/moderation/appeals
 *   GET  /api/v1/moderation/appeals
 *   PUT  /api/v1/moderation/appeals/:id
 *   PUT  /api/v1/moderation/content-state
 */

import request from 'supertest';
import express from 'express';
import { ObjectId } from 'mongodb';
import {
  setupE2eDb,
  teardownE2eDb,
  clearAndReindex,
  getE2eDb,
  registerUser,
  loginUser,
  promoteToAdmin,
} from './setup';

let app: express.Application;

beforeAll(async () => {
  const result = await setupE2eDb();
  app = result.app;
});

afterAll(async () => {
  await teardownE2eDb();
});

beforeEach(async () => {
  await clearAndReindex();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setupModeratorSession(): Promise<{
  cookies: string[];
  csrfToken: string;
  userId: string;
}> {
  const db = getE2eDb();
  const { userId } = await registerUser(app, {
    username: 'mod_flow_user',
    password: 'ModeratorPass12345',
    displayName: 'Mod Flow User',
  });
  await db
    .collection('users')
    .updateOne({ _id: new ObjectId(userId) }, { $set: { roles: ['moderator'] } });
  const { cookies, csrfToken } = await loginUser(app, {
    username: 'mod_flow_user',
    password: 'ModeratorPass12345',
  });
  return { cookies, csrfToken, userId };
}

/**
 * Seeds a visible QA thread that can be used as reportable content.
 * We need a real content document to satisfy the moderation service's lookup.
 */
async function seedReportableQaThread(authorUserId: string, roomId: string): Promise<string> {
  const db = getE2eDb();
  const result = await db.collection('qa_threads').insertOne({
    userId: authorUserId,
    roomId,
    title: 'Is the projector working?',
    body: 'Has anyone used the projector recently? Need to know for tomorrow.',
    state: 'visible',
    isPinned: false,
    moderationLocked: false,
    postCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return result.insertedId.toString();
}

async function seedRoom(): Promise<{ roomId: string; zoneId: string }> {
  const db = getE2eDb();
  const zoneResult = await db.collection('zones').insertOne({
    name: 'Mod Zone',
    description: 'For moderation tests',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  const zoneId = zoneResult.insertedId.toString();
  const roomResult = await db.collection('rooms').insertOne({
    zoneId,
    name: 'Mod Room',
    capacity: 4,
    amenities: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return { roomId: roomResult.insertedId.toString(), zoneId };
}

// ── Submit a moderation report ────────────────────────────────────────────────

describe('Moderation flow — Submit report (POST /moderation/reports)', () => {
  it('creates a report for a QA thread and returns submitted status', async () => {
    const { cookies, csrfToken, userId } = await registerUser(app, {
      username: 'reporter_user1',
      password: 'ReporterPass12345',
      displayName: 'Reporter User 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const res = await request(app)
      .post('/api/v1/moderation/reports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        reason: 'This content violates community guidelines and should be reviewed.',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const report = res.body.data;
    expect(report._id).toBeDefined();
    expect(report.contentType).toBe('qa_thread');
    expect(report.contentId).toBe(threadId);
    expect(report.status).toBeDefined();
    expect(report.createdAt).toBeDefined();
  });

  it('requires authentication to submit a report', async () => {
    // CSRF middleware runs before auth middleware for POST requests.
    // An unauthenticated POST without a matching CSRF cookie gets 403
    // (CSRF_MISSING/CSRF_MISMATCH) before auth can return 401.
    const res = await request(app)
      .post('/api/v1/moderation/reports')
      .send({ contentType: 'qa_thread', contentId: 'fakeid', reason: 'Spam content here.' });

    expect([401, 403]).toContain(res.status);
  });

  it('returns 400 when required fields are missing', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'reporter_user2',
      password: 'ReporterPass12345',
      displayName: 'Reporter User 2',
    });

    const res = await request(app)
      .post('/api/v1/moderation/reports')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ contentType: 'qa_thread' }); // missing contentId and reason

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── List reports (moderator) ──────────────────────────────────────────────────

describe('Moderation flow — List reports (GET /moderation/reports)', () => {
  it('moderator can list reports with pagination meta', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'reporter_list1',
      password: 'ReporterPass12345',
      displayName: 'Reporter List 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    // Submit a report
    await request(app)
      .post('/api/v1/moderation/reports')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        reason: 'Report for listing test — contains inappropriate language.',
      });

    const { cookies: modCookies } = await setupModeratorSession();

    const res = await request(app)
      .get('/api/v1/moderation/reports')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', modCookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    // ModerationPage.tsx Report interface
    const report = res.body.data[0];
    expect(report._id).toBeDefined();
    expect(report.contentType).toBeDefined();
    expect(report.contentId).toBeDefined();
    expect(report.status).toBeDefined();
    expect(report.createdAt).toBeDefined();

    // Pagination meta
    expect(res.body.meta).toBeDefined();
    expect(typeof (res.body.meta as { total?: number }).total).toBe('number');
  });

  it('regular user cannot list reports (403)', async () => {
    const { cookies } = await registerUser(app, {
      username: 'noaccess_rep1',
      password: 'NoAccessPass12345',
      displayName: 'No Access Rep 1',
    });

    const res = await request(app)
      .get('/api/v1/moderation/reports')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  it('supports status filter on reports list', async () => {
    const { cookies: modCookies } = await setupModeratorSession();

    const res = await request(app)
      .get('/api/v1/moderation/reports')
      .query({ status: 'submitted', page: '1', pageSize: '10' })
      .set('Cookie', modCookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── Transition report status ──────────────────────────────────────────────────

describe('Moderation flow — Report status transitions (PUT /moderation/reports/:id)', () => {
  it('transitions a report from submitted to under_review', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'reporter_trans1',
      password: 'ReporterPass12345',
      displayName: 'Reporter Trans 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const reportRes = await request(app)
      .post('/api/v1/moderation/reports')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        reason: 'Transitioning report — this content seems to be spam.',
      });

    expect(reportRes.status).toBe(201);
    const reportId = reportRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    // Transition to under_review
    const updateRes = await request(app)
      .put(`/api/v1/moderation/reports/${reportId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'under_review' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);
    expect(updateRes.body.data.status).toBe('under_review');
  });

  it('transitions a report from under_review to actioned', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'reporter_trans2',
      password: 'ReporterPass12345',
      displayName: 'Reporter Trans 2',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const reportRes = await request(app)
      .post('/api/v1/moderation/reports')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        reason: 'Double-transition report — needs to be actioned by moderator.',
      });

    const reportId = reportRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    // Move to under_review first
    await request(app)
      .put(`/api/v1/moderation/reports/${reportId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'under_review' });

    // Then action it
    const actionRes = await request(app)
      .put(`/api/v1/moderation/reports/${reportId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'actioned' });

    expect(actionRes.status).toBe(200);
    expect(actionRes.body.ok).toBe(true);
    expect(actionRes.body.data.status).toBe('actioned');
  });

  it('requires moderator role to update report status', async () => {
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'reporter_norole1',
      password: 'ReporterPass12345',
      displayName: 'Reporter No Role 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const reportRes = await request(app)
      .post('/api/v1/moderation/reports')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        reason: 'This user will try to update their own report status.',
      });

    const reportId = reportRes.body.data._id as string;

    // Same regular user tries to update status
    const updateRes = await request(app)
      .put(`/api/v1/moderation/reports/${reportId}`)
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({ status: 'dismissed' });

    expect([403, 401]).toContain(updateRes.status);
  });
});

// ── Appeal a moderation action ────────────────────────────────────────────────

describe('Moderation flow — Appeals (POST /moderation/appeals)', () => {
  it('creates an appeal for a moderation action', async () => {
    const db = getE2eDb();
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'appeal_user1',
      password: 'AppealPass12345',
      displayName: 'Appeal User 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    // Seed a moderation action document directly (simulates a moderator having actioned content)
    const actionResult = await db.collection('moderation_actions').insertOne({
      contentType: 'qa_thread',
      contentId: threadId,
      moderatorUserId: userId,
      action: 'state_change',
      fromState: 'visible',
      toState: 'hidden',
      createdAt: new Date(),
    });
    const moderationActionId = actionResult.insertedId.toString();

    const res = await request(app)
      .post('/api/v1/moderation/appeals')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        moderationActionId,
        reason: 'My thread was removed unfairly. It follows all community guidelines properly.',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const appeal = res.body.data;
    expect(appeal._id).toBeDefined();
    expect(appeal.contentType).toBe('qa_thread');
    expect(appeal.contentId).toBe(threadId);
    expect(appeal.moderationActionId).toBe(moderationActionId);
    expect(appeal.createdAt).toBeDefined();
  });

  it('returns 400 when appeal fields are missing', async () => {
    const { cookies, csrfToken } = await registerUser(app, {
      username: 'appeal_user2',
      password: 'AppealPass12345',
      displayName: 'Appeal User 2',
    });

    const res = await request(app)
      .post('/api/v1/moderation/appeals')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({ contentType: 'qa_thread' }); // missing required fields

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── Process appeals (moderator accept/reject) ─────────────────────────────────

describe('Moderation flow — Process appeals (PUT /moderation/appeals/:id)', () => {
  it('moderator can accept an appeal', async () => {
    const db = getE2eDb();
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'appeal_accept1',
      password: 'AppealPass12345',
      displayName: 'Appeal Accept 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const actionResult = await db.collection('moderation_actions').insertOne({
      contentType: 'qa_thread',
      contentId: threadId,
      moderatorUserId: userId,
      action: 'state_change',
      fromState: 'visible',
      toState: 'hidden',
      createdAt: new Date(),
    });
    const moderationActionId = actionResult.insertedId.toString();

    const appealRes = await request(app)
      .post('/api/v1/moderation/appeals')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        moderationActionId,
        reason: 'Requesting appeal review — content was removed without proper justification.',
      });

    expect(appealRes.status).toBe(201);
    const appealId = appealRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    // Appeal state machine: submitted → under_review → accepted
    const reviewRes = await request(app)
      .put(`/api/v1/moderation/appeals/${appealId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'under_review' });

    expect(reviewRes.status).toBe(200);

    const acceptRes = await request(app)
      .put(`/api/v1/moderation/appeals/${appealId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'accepted' });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.ok).toBe(true);
    expect(acceptRes.body.data.status).toBe('accepted');
  });

  it('moderator can reject an appeal', async () => {
    const db = getE2eDb();
    const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerUser(app, {
      username: 'appeal_reject1',
      password: 'AppealPass12345',
      displayName: 'Appeal Reject 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const actionResult = await db.collection('moderation_actions').insertOne({
      contentType: 'qa_thread',
      contentId: threadId,
      moderatorUserId: userId,
      action: 'state_change',
      fromState: 'visible',
      toState: 'hidden',
      createdAt: new Date(),
    });
    const moderationActionId = actionResult.insertedId.toString();

    const appealRes = await request(app)
      .post('/api/v1/moderation/appeals')
      .set('Cookie', userCookies)
      .set('x-csrf-token', userCsrf)
      .send({
        contentType: 'qa_thread',
        contentId: threadId,
        moderationActionId,
        reason: 'I believe this removal was unjust and should be reconsidered by staff.',
      });

    const appealId = appealRes.body.data._id as string;

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    // Appeal state machine: submitted → under_review → denied
    await request(app)
      .put(`/api/v1/moderation/appeals/${appealId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'under_review' });

    const rejectRes = await request(app)
      .put(`/api/v1/moderation/appeals/${appealId}`)
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ status: 'denied' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.ok).toBe(true);
    expect(rejectRes.body.data.status).toBe('denied');
  });

  it('moderator can list appeals with pagination', async () => {
    const { cookies: modCookies } = await setupModeratorSession();

    const res = await request(app)
      .get('/api/v1/moderation/appeals')
      .query({ page: '1', pageSize: '20' })
      .set('Cookie', modCookies);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
  });

  it('regular user cannot list appeals (403)', async () => {
    const { cookies } = await registerUser(app, {
      username: 'appeal_norole2',
      password: 'AppealPass12345',
      displayName: 'Appeal No Role 2',
    });

    const res = await request(app)
      .get('/api/v1/moderation/appeals')
      .set('Cookie', cookies);

    expect([403, 401]).toContain(res.status);
  });
});

// ── Content state change (direct moderator action) ────────────────────────────

describe('Moderation flow — Content state change (PUT /moderation/content-state)', () => {
  it('moderator can change content state to collapsed', async () => {
    const { userId } = await registerUser(app, {
      username: 'content_author1',
      password: 'ContentPass12345',
      displayName: 'Content Author 1',
    });
    const { roomId } = await seedRoom();
    const threadId = await seedReportableQaThread(userId, roomId);

    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    // 'visible' → 'collapsed' is a valid content state transition
    const res = await request(app)
      .put('/api/v1/moderation/content-state')
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ contentType: 'qa_thread', contentId: threadId, state: 'collapsed' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.state).toBe('collapsed');
    // moderationActionId is returned for appeal linking
    expect(res.body.data.moderationActionId).toBeDefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const { cookies: modCookies, csrfToken: modCsrf } = await setupModeratorSession();

    const res = await request(app)
      .put('/api/v1/moderation/content-state')
      .set('Cookie', modCookies)
      .set('x-csrf-token', modCsrf)
      .send({ contentType: 'qa_thread' }); // missing contentId and state

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
