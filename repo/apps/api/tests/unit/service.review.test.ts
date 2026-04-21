/**
 * Unit tests for services/review.service.ts
 *
 * All MongoDB and filesystem interactions are mocked.
 * Tests cover:
 *   - createReview: rating bounds, text length, reservation ownership,
 *     reservation status gating, duplicate detection, sensitive-word block
 *   - updateReview: author-only, moderation-lock, edit window
 *   - getReview: removed-review visibility rules
 */

import './setup';

// ── mock DB layer ──────────────────────────────────────────────────────────────

const mockReviewsFindOne = jest.fn();
const mockReviewsInsertOne = jest.fn();
const mockReviewsFindOneAndUpdate = jest.fn();
const mockReviewsCountDocuments = jest.fn();
const mockReservationsFindOne = jest.fn();
const mockMediaCountDocuments = jest.fn();
const mockMediaInsertOne = jest.fn();
const mockMediaFind = jest.fn();
const mockUserFind = jest.fn();

jest.mock('../../src/config/db', () => ({
  getCollection: (name: string) => {
    if (name === 'reviews') {
      return {
        findOne: mockReviewsFindOne,
        insertOne: mockReviewsInsertOne,
        findOneAndUpdate: mockReviewsFindOneAndUpdate,
        countDocuments: mockReviewsCountDocuments,
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      };
    }
    if (name === 'reservations') {
      return { findOne: mockReservationsFindOne };
    }
    if (name === 'review_media') {
      return {
        countDocuments: mockMediaCountDocuments,
        insertOne: mockMediaInsertOne,
        find: mockMediaFind,
      };
    }
    if (name === 'users') {
      return {
        find: mockUserFind,
      };
    }
    return { findOne: jest.fn(), insertOne: jest.fn() };
  },
}));

jest.mock('../../src/services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/contentSafety.service', () => ({
  checkSensitiveWords: jest.fn().mockResolvedValue({ blocked: false, words: [] }),
  checkSpamLimit: jest.fn().mockResolvedValue({ allowed: true }),
  recordPost: jest.fn().mockResolvedValue(undefined),
}));

import { ObjectId } from 'mongodb';
import { createReview, updateReview, getReview } from '../../src/services/review.service';
import { checkSensitiveWords, checkSpamLimit } from '../../src/services/contentSafety.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../src/services/auth.service';
import { REVIEW_EDIT_WINDOW_HOURS } from '@studyroomops/shared-policy';

const mockCheckSensitiveWords = checkSensitiveWords as jest.Mock;
const mockCheckSpamLimit = checkSpamLimit as jest.Mock;

// ── helpers ────────────────────────────────────────────────────────────────────

const userId = 'user-abc';
const reservationId = new ObjectId().toString();
const roomId = 'room-xyz';

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(reservationId),
    userId,
    roomId,
    status: 'completed',
    ...overrides,
  };
}

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId,
    reservationId,
    roomId,
    rating: 4,
    text: 'This is a great study room with good lighting and quiet environment.',
    state: 'visible',
    moderationLocked: false,
    isPinned: false,
    featured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

const VALID_TEXT = 'This is a good study room with adequate space and decent lighting.';

// ── createReview ───────────────────────────────────────────────────────────────

describe('createReview()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReservationsFindOne.mockResolvedValue(makeReservation());
    mockReviewsFindOne.mockResolvedValue(null); // no duplicate
    mockReviewsInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
    mockCheckSensitiveWords.mockResolvedValue({ blocked: false, words: [] });
    mockCheckSpamLimit.mockResolvedValue({ allowed: true });
  });

  it('throws ValidationError for rating below 1', async () => {
    await expect(createReview(userId, reservationId, 0, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for rating above 5', async () => {
    await expect(createReview(userId, reservationId, 6, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for non-integer rating', async () => {
    await expect(createReview(userId, reservationId, 3.5, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for text shorter than minimum length', async () => {
    await expect(createReview(userId, reservationId, 4, 'Too short')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for text longer than 2000 characters', async () => {
    const longText = 'a'.repeat(2001);
    await expect(createReview(userId, reservationId, 4, longText)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for an invalid reservation ID', async () => {
    await expect(createReview(userId, 'not-valid-oid', 4, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when reservation does not exist', async () => {
    mockReservationsFindOne.mockResolvedValue(null);
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when reviewer is not the reservation owner', async () => {
    mockReservationsFindOne.mockResolvedValue(makeReservation({ userId: 'other-user' }));
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError when reservation is in confirmed status', async () => {
    mockReservationsFindOne.mockResolvedValue(makeReservation({ status: 'confirmed' }));
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when reservation is canceled', async () => {
    mockReservationsFindOne.mockResolvedValue(makeReservation({ status: 'canceled' }));
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ConflictError when a review for the reservation already exists', async () => {
    mockReviewsFindOne.mockResolvedValue(makeReview());
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ValidationError when sensitive word check blocks the text', async () => {
    mockCheckSensitiveWords.mockResolvedValue({ blocked: true, words: ['spam'] });
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws when spam limit is exceeded', async () => {
    mockCheckSpamLimit.mockResolvedValue({ allowed: false, nextAllowedAt: new Date() });
    await expect(createReview(userId, reservationId, 4, VALID_TEXT)).rejects.toThrow('Posting too frequently');
  });

  it('creates a review successfully with valid inputs', async () => {
    const insertedId = new ObjectId();
    mockReviewsInsertOne.mockResolvedValue({ insertedId });

    const result = await createReview(userId, reservationId, 5, VALID_TEXT);

    expect(result.rating).toBe(5);
    expect(result.text).toBe(VALID_TEXT.trim());
    expect(result.state).toBe('visible');
    expect(result.userId).toBe(userId);
    expect(result.reservationId).toBe(reservationId);
  });

  it('trims whitespace from review text', async () => {
    const insertedId = new ObjectId();
    mockReviewsInsertOne.mockResolvedValue({ insertedId });

    const result = await createReview(userId, reservationId, 3, `  ${VALID_TEXT}  `);
    expect(result.text).toBe(VALID_TEXT);
  });

  it('allows a review for a checked_in reservation', async () => {
    mockReservationsFindOne.mockResolvedValue(makeReservation({ status: 'checked_in' }));
    const insertedId = new ObjectId();
    mockReviewsInsertOne.mockResolvedValue({ insertedId });

    const result = await createReview(userId, reservationId, 4, VALID_TEXT);
    expect(result.rating).toBe(4);
  });
});

// ── updateReview ───────────────────────────────────────────────────────────────

describe('updateReview()', () => {
  const reviewId = new ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
    mockReviewsFindOne.mockResolvedValue(makeReview({ _id: new ObjectId(reviewId) }));
    mockReviewsFindOneAndUpdate.mockResolvedValue(makeReview({ _id: new ObjectId(reviewId), rating: 3 }));
    mockCheckSensitiveWords.mockResolvedValue({ blocked: false, words: [] });
  });

  it('throws NotFoundError when review does not exist', async () => {
    mockReviewsFindOne.mockResolvedValue(null);
    await expect(updateReview(reviewId, userId, { rating: 3 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when updater is not the review author', async () => {
    await expect(updateReview(reviewId, 'other-user', { rating: 3 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when review is moderation locked', async () => {
    mockReviewsFindOne.mockResolvedValue(makeReview({ moderationLocked: true }));
    await expect(updateReview(reviewId, userId, { rating: 3 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when edit window has passed', async () => {
    const oldDate = new Date(Date.now() - (REVIEW_EDIT_WINDOW_HOURS + 1) * 3600 * 1000);
    mockReviewsFindOne.mockResolvedValue(makeReview({ createdAt: oldDate }));
    await expect(updateReview(reviewId, userId, { rating: 3 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError for an out-of-bounds rating in update', async () => {
    await expect(updateReview(reviewId, userId, { rating: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateReview(reviewId, userId, { rating: 6 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for updated text that is too short', async () => {
    await expect(updateReview(reviewId, userId, { text: 'short' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns updated review when changes are valid', async () => {
    const updatedReview = makeReview({ rating: 3 });
    mockReviewsFindOneAndUpdate.mockResolvedValue(updatedReview);

    const result = await updateReview(reviewId, userId, { rating: 3 });
    expect(result.rating).toBe(3);
  });
});

// ── getReview ─────────────────────────────────────────────────────────────────

describe('getReview()', () => {
  const reviewId = new ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFoundError when review does not exist', async () => {
    mockReviewsFindOne.mockResolvedValue(null);
    await expect(getReview(reviewId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when review is removed and viewer is not a moderator', async () => {
    mockReviewsFindOne.mockResolvedValue(makeReview({ state: 'removed' }));
    await expect(getReview(reviewId, userId, ['member'])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns a removed review to a moderator', async () => {
    const removedReview = makeReview({ state: 'removed' });
    mockReviewsFindOne.mockResolvedValue(removedReview);

    const result = await getReview(reviewId, 'mod-1', ['moderator']);
    expect((result as any).state).toBe('removed');
  });

  it('returns a removed review to an administrator', async () => {
    const removedReview = makeReview({ state: 'removed' });
    mockReviewsFindOne.mockResolvedValue(removedReview);

    const result = await getReview(reviewId, 'admin-1', ['administrator']);
    expect((result as any).state).toBe('removed');
  });

  it('returns a visible review to a regular user', async () => {
    mockReviewsFindOne.mockResolvedValue(makeReview({ state: 'visible' }));
    const result = await getReview(reviewId, userId, ['member']);
    expect((result as any).state).toBe('visible');
  });

  it('returns a collapsed review to a regular user', async () => {
    mockReviewsFindOne.mockResolvedValue(makeReview({ state: 'collapsed' }));
    const result = await getReview(reviewId, userId, ['member']);
    expect((result as any).state).toBe('collapsed');
  });

  it('throws ValidationError for an invalid review ID', async () => {
    await expect(getReview('not-an-oid')).rejects.toBeInstanceOf(ValidationError);
  });
});
