import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setupTestDb, teardownTestDb, getTestApp, getTestDb } from '../setup';
import express from 'express';

let app: express.Application;

function createAgent() {
  return request.agent(app);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getCsrf(agent?: ReturnType<typeof request.agent>): Promise<string | { token: string; csrfCookies: string[] }> {
  if (agent) {
    const res = await agent.get('/api/v1/auth/csrf');
    return res.body.data.csrfToken as string;
  }
  const res = await request(app).get('/api/v1/auth/csrf');
  return {
    token: res.body.data.csrfToken as string,
    csrfCookies: (res.headers['set-cookie'] as unknown as string[]) || [],
  };
}

async function registerAndLogin(
  username: string,
  password: string,
  displayName: string,
  roles?: string[]
): Promise<{ cookies: string[]; csrfToken: string; userId: string }> {
  const ag = createAgent();
  const csrf1 = await getCsrf(ag) as string;
  const regRes = await ag
    .post('/api/v1/auth/register')
    .set('x-csrf-token', csrf1)
    .send({ username, password, displayName });

  expect(regRes.status).toBe(200);
  const userId = regRes.body.data.user._id as string;

  if (roles && roles.length > 0) {
    const db = getTestDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles } }
    );
  }

  const csrf2 = await getCsrf(ag) as string;
  const loginRes = await ag
    .post('/api/v1/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ username, password });

  expect(loginRes.status).toBe(200);
  const cookies = loginRes.headers['set-cookie'] as unknown as string[];
  const csrfToken = loginRes.body.data.csrfToken as string;

  return { cookies, csrfToken, userId };
}

/** Insert a visible review directly into the DB and return its id */
async function insertVisibleReview(userId: string, roomId: string): Promise<string> {
  const db = getTestDb();
  const result = await db.collection('reviews').insertOne({
    userId,
    roomId,
    reservationId: new ObjectId().toString(),
    rating: 3,
    text: 'Average room, nothing spectacular.',
    state: 'visible',
    isPinned: false,
    featured: false,
    moderationLocked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });
  return result.insertedId.toString();
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const result = await setupTestDb();
  app = result.app;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  const db = getTestDb();
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.collection(col.name).deleteMany({});
  }
  const { bootstrapIndexes } = await import('../../src/config/db');
  await bootstrapIndexes();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Moderation API', () => {
  describe('POST /api/v1/moderation/reports', () => {
    it('creates a content report', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'reporter1', 'ModPass1234!', 'Reporter One'
      );
      const reviewId = await insertVisibleReview(userId, new ObjectId().toString());

      const res = await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({
          contentType: 'review',
          contentId: reviewId,
          reason: 'Contains inappropriate language',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.status).toBe('open');
      expect(res.body.data.contentType).toBe('review');
    });

    it('rejects duplicate report for same content by same user', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'reporter2', 'ModPass1234!', 'Reporter Two'
      );
      const reviewId = await insertVisibleReview(userId, new ObjectId().toString());

      await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'review', contentId: reviewId, reason: 'Spam content in this review' });

      const res2 = await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'review', contentId: reviewId, reason: 'Spam content in this review' });

      expect(res2.status).toBe(409);
      expect(res2.body.ok).toBe(false);
    });
  });

  describe('PUT /api/v1/moderation/reports/:id', () => {
    it('updates report status open → under_review (moderator)', async () => {
      const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerAndLogin(
        'reporter3', 'ModPass1234!', 'Reporter Three'
      );
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'moduser1', 'ModPass1234!', 'Mod User One', ['moderator']
      );
      const reviewId = await insertVisibleReview(userId, new ObjectId().toString());

      const reportRes = await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ contentType: 'review', contentId: reviewId, reason: 'Offensive content reported here' });

      expect(reportRes.status).toBe(201);
      const reportId = reportRes.body.data._id as string;

      const updateRes = await request(app)
        .put(`/api/v1/moderation/reports/${reportId}`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ status: 'under_review' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.status).toBe('under_review');
    });

    it('actioned report changes content state to removed', async () => {
      const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerAndLogin(
        'reporter4', 'ModPass1234!', 'Reporter Four'
      );
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'moduser2', 'ModPass1234!', 'Mod User Two', ['moderator']
      );
      const reviewId = await insertVisibleReview(userId, new ObjectId().toString());

      const reportRes = await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ contentType: 'review', contentId: reviewId, reason: 'Violates community guidelines' });
      expect(reportRes.status).toBe(201);
      const reportId = reportRes.body.data._id as string;

      // Transition open → under_review first
      await request(app)
        .put(`/api/v1/moderation/reports/${reportId}`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ status: 'under_review' });

      // Transition under_review → actioned
      const actionRes = await request(app)
        .put(`/api/v1/moderation/reports/${reportId}`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ status: 'actioned' });

      expect(actionRes.status).toBe(200);
      expect(actionRes.body.data.status).toBe('actioned');

      // Verify review state changed to 'removed'
      const db = getTestDb();
      const review = await db.collection('reviews').findOne({ _id: new ObjectId(reviewId) }) as any;
      expect(review.state).toBe('removed');
    });

    it('non-moderator cannot update report status (403)', async () => {
      const { cookies, csrfToken, userId } = await registerAndLogin(
        'reporter5', 'ModPass1234!', 'Reporter Five'
      );
      const reviewId = await insertVisibleReview(userId, new ObjectId().toString());

      const reportRes = await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'review', contentId: reviewId, reason: 'Attempting to update report' });
      expect(reportRes.status).toBe(201);
      const reportId = reportRes.body.data._id as string;

      const updateRes = await request(app)
        .put(`/api/v1/moderation/reports/${reportId}`)
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'under_review' });

      expect(updateRes.status).toBe(403);
    });
  });

  describe('POST /api/v1/moderation/appeals', () => {
    it('creates an appeal for moderated content', async () => {
      const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerAndLogin(
        'appellant1', 'ModPass1234!', 'Appellant One'
      );
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'moduser3', 'ModPass1234!', 'Mod User Three', ['moderator']
      );

      const roomId = new ObjectId().toString();
      const reviewId = await insertVisibleReview(userId, roomId);

      // Moderator removes the content via content-state change
      const stateRes = await request(app)
        .put('/api/v1/moderation/content-state')
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ contentType: 'review', contentId: reviewId, state: 'removed' });

      expect(stateRes.status).toBe(200);
      const moderationActionId = stateRes.body.data.moderationActionId as string;

      // User appeals the moderation
      const appealRes = await request(app)
        .post('/api/v1/moderation/appeals')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({
          contentType: 'review',
          contentId: reviewId,
          moderationActionId,
          reason: 'My review was removed unfairly without cause.',
        });

      expect(appealRes.status).toBe(201);
      expect(appealRes.body.ok).toBe(true);
      expect(appealRes.body.data.status).toBe('submitted');
    });

    it('accepted appeal restores content to visible', async () => {
      const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerAndLogin(
        'appellant2', 'ModPass1234!', 'Appellant Two'
      );
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'moduser4', 'ModPass1234!', 'Mod User Four', ['moderator']
      );

      const roomId = new ObjectId().toString();
      const reviewId = await insertVisibleReview(userId, roomId);

      // Remove content
      const stateRes = await request(app)
        .put('/api/v1/moderation/content-state')
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ contentType: 'review', contentId: reviewId, state: 'removed' });
      expect(stateRes.status).toBe(200);
      const moderationActionId = stateRes.body.data.moderationActionId as string;

      // Submit appeal
      const appealRes = await request(app)
        .post('/api/v1/moderation/appeals')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({
          contentType: 'review',
          contentId: reviewId,
          moderationActionId,
          reason: 'The content was flagged incorrectly by automated system.',
        });
      expect(appealRes.status).toBe(201);
      const appealId = appealRes.body.data._id as string;

      // Moderator transitions appeal to under_review first (required by state machine)
      const underReviewRes = await request(app)
        .put(`/api/v1/moderation/appeals/${appealId}`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ status: 'under_review' });

      expect(underReviewRes.status).toBe(200);
      expect(underReviewRes.body.data.status).toBe('under_review');

      // Moderator accepts appeal
      const acceptRes = await request(app)
        .put(`/api/v1/moderation/appeals/${appealId}`)
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ status: 'accepted' });

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.data.status).toBe('accepted');

      // Verify review is restored to visible
      const db = getTestDb();
      const review = await db.collection('reviews').findOne({ _id: new ObjectId(reviewId) }) as any;
      expect(review.state).toBe('visible');
    });
  });

  describe('GET /api/v1/moderation/reports', () => {
    it('returns reports for moderator', async () => {
      const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerAndLogin(
        'reporter6', 'ModPass1234!', 'Reporter Six'
      );
      const { cookies: modCookies } = await registerAndLogin(
        'moduser5', 'ModPass1234!', 'Mod User Five', ['moderator']
      );

      const reviewId = await insertVisibleReview(userId, new ObjectId().toString());

      // Create a report
      await request(app)
        .post('/api/v1/moderation/reports')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({ contentType: 'review', contentId: reviewId, reason: 'Inappropriate language in review text' });

      const listRes = await request(app)
        .get('/api/v1/moderation/reports')
        .set('Cookie', modCookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects non-moderator with 403', async () => {
      const { cookies } = await registerAndLogin(
        'reporter7', 'ModPass1234!', 'Reporter Seven'
      );

      const listRes = await request(app)
        .get('/api/v1/moderation/reports')
        .set('Cookie', cookies);

      expect(listRes.status).toBe(403);
    });
  });

  describe('GET /api/v1/moderation/appeals', () => {
    it('returns appeals for moderator', async () => {
      const { cookies: userCookies, csrfToken: userCsrf, userId } = await registerAndLogin(
        'appellant3', 'ModPass1234!', 'Appellant Three'
      );
      const { cookies: modCookies, csrfToken: modCsrf } = await registerAndLogin(
        'moduser6', 'ModPass1234!', 'Mod User Six', ['moderator']
      );

      const roomId = new ObjectId().toString();
      const reviewId = await insertVisibleReview(userId, roomId);

      // Remove content to create a moderationAction
      const stateRes = await request(app)
        .put('/api/v1/moderation/content-state')
        .set('Cookie', modCookies)
        .set('x-csrf-token', modCsrf)
        .send({ contentType: 'review', contentId: reviewId, state: 'removed' });
      expect(stateRes.status).toBe(200);
      const moderationActionId = stateRes.body.data.moderationActionId as string;

      // User submits an appeal
      await request(app)
        .post('/api/v1/moderation/appeals')
        .set('Cookie', userCookies)
        .set('x-csrf-token', userCsrf)
        .send({
          contentType: 'review',
          contentId: reviewId,
          moderationActionId,
          reason: 'The removal was a mistake; my review follows all community guidelines.',
        });

      const listRes = await request(app)
        .get('/api/v1/moderation/appeals')
        .set('Cookie', modCookies);

      expect(listRes.status).toBe(200);
      expect(listRes.body.ok).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects non-moderator with 403', async () => {
      const { cookies } = await registerAndLogin(
        'appellant4', 'ModPass1234!', 'Appellant Four'
      );

      const listRes = await request(app)
        .get('/api/v1/moderation/appeals')
        .set('Cookie', cookies);

      expect(listRes.status).toBe(403);
    });
  });
});
