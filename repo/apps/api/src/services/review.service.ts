import { ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { getCollection } from '../config/db';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from './auth.service';
import { writeAuditLog } from './audit.service';
import { checkSensitiveWords, checkSpamLimit, recordPost } from './contentSafety.service';
import { hasRole } from '../middleware/auth';
import { hashSha256, encryptFileBuffer, decryptFileBuffer } from '../utils/crypto';
import {
  REVIEW_MIN_TEXT_LENGTH,
  REVIEW_MAX_TEXT_LENGTH,
  REVIEW_EDIT_WINDOW_HOURS,
  REVIEW_MAX_IMAGES,
  REVIEW_ALLOWED_MIME_TYPES,
  MAGIC_BYTES,
} from '@studyroomops/shared-policy';

// ── Media helpers ─────────────────────────────────────────────────────────────

const REVIEW_UPLOAD_DIR = path.join(
  process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'),
  'review-media'
);

function ensureReviewUploadDir(): void {
  if (!fs.existsSync(REVIEW_UPLOAD_DIR)) {
    fs.mkdirSync(REVIEW_UPLOAD_DIR, { recursive: true });
  }
}

function checkMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;
  return signatures.some((sig: number[]) => sig.every((byte: number, i: number) => buffer[i] === byte));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function reviewId(id: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new ValidationError('Invalid review id');
  }
}

// ── Create Review ─────────────────────────────────────────────────────────────

export async function createReview(
  userId: string,
  reservationId: string,
  rating: number,
  text: string,
  idempotencyKey?: string
): Promise<Record<string, unknown>> {
  // 1. Validate rating
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError('Rating must be an integer between 1 and 5');
  }

  // 2. Validate text length
  const trimmedText = (text || '').trim();
  if (trimmedText.length < REVIEW_MIN_TEXT_LENGTH) {
    throw new ValidationError(`Review text must be at least ${REVIEW_MIN_TEXT_LENGTH} characters`);
  }
  if (trimmedText.length > REVIEW_MAX_TEXT_LENGTH) {
    throw new ValidationError(`Review text must be at most ${REVIEW_MAX_TEXT_LENGTH} characters`);
  }

  // 3. Load reservation
  let resOid: ObjectId;
  try {
    resOid = new ObjectId(reservationId);
  } catch {
    throw new ValidationError('Invalid reservation id');
  }

  const reservations = getCollection('reservations');
  const reservation = await reservations.findOne({ _id: resOid }) as any;
  if (!reservation) throw new NotFoundError('Reservation not found');

  // 4. Author must be reservation owner
  if (reservation.userId !== userId) {
    throw new ForbiddenError('You can only review your own reservations');
  }

  // 5. Reservation must be in checked_in or completed state
  if (!['checked_in', 'completed'].includes(reservation.status)) {
    throw new ValidationError('You can only review checked-in or completed reservations');
  }

  // 6. One review per reservation
  const reviews = getCollection('reviews');
  const existing = await reviews.findOne({ reservationId });
  if (existing) {
    throw new ConflictError('A review for this reservation already exists');
  }

  // 7. Sensitive word check
  const safetyResult = await checkSensitiveWords(trimmedText);
  if (safetyResult.blocked) {
    throw new ValidationError(
      `Review contains prohibited content: ${safetyResult.words.join(', ')}`
    );
  }

  // 8. Spam check
  const spamResult = await checkSpamLimit(userId);
  if (!spamResult.allowed) {
    const err = new Error('Posting too frequently. Please try again later.') as any;
    err.name = 'SpamLimitError';
    err.nextAllowedAt = spamResult.nextAllowedAt;
    throw err;
  }

  const now = new Date();
  const doc: Record<string, unknown> = {
    userId,
    reservationId,
    roomId: reservation.roomId,
    rating,
    text: trimmedText,
    state: 'visible',
    isPinned: false,
    featured: false,
    moderationLocked: false,
    idempotencyKey: idempotencyKey || null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await reviews.insertOne(doc as any);
  await recordPost(userId);

  return { ...doc, _id: result.insertedId.toString() };
}

// ── Update Review ─────────────────────────────────────────────────────────────

export async function updateReview(
  reviewId_: string,
  userId: string,
  updates: { rating?: number; text?: string }
): Promise<Record<string, unknown>> {
  const oid = reviewId(reviewId_);
  const reviews = getCollection('reviews');
  const review = await reviews.findOne({ _id: oid }) as any;
  if (!review) throw new NotFoundError('Review not found');

  // Author only
  if (review.userId !== userId) throw new ForbiddenError('You can only edit your own reviews');

  // Moderation locked
  if (review.moderationLocked) {
    throw new ForbiddenError('This review is locked by moderation and cannot be edited');
  }

  // Edit window
  const editWindowMs = REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
  if (Date.now() - new Date(review.createdAt).getTime() > editWindowMs) {
    throw new ForbiddenError(
      `Reviews can only be edited within ${REVIEW_EDIT_WINDOW_HOURS} hours of creation`
    );
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.rating !== undefined) {
    if (!Number.isInteger(updates.rating) || updates.rating < 1 || updates.rating > 5) {
      throw new ValidationError('Rating must be an integer between 1 and 5');
    }
    patch.rating = updates.rating;
  }

  if (updates.text !== undefined) {
    const trimmed = updates.text.trim();
    if (trimmed.length < REVIEW_MIN_TEXT_LENGTH) {
      throw new ValidationError(`Review text must be at least ${REVIEW_MIN_TEXT_LENGTH} characters`);
    }
    if (trimmed.length > REVIEW_MAX_TEXT_LENGTH) {
      throw new ValidationError(`Review text must be at most ${REVIEW_MAX_TEXT_LENGTH} characters`);
    }

    const safety = await checkSensitiveWords(trimmed);
    if (safety.blocked) {
      throw new ValidationError(
        `Review contains prohibited content: ${safety.words.join(', ')}`
      );
    }

    patch.text = trimmed;
  }

  const updated = await reviews.findOneAndUpdate(
    { _id: oid },
    { $set: patch, $inc: { version: 1 } },
    { returnDocument: 'after' }
  ) as any;

  return updated;
}

// ── Get Review ────────────────────────────────────────────────────────────────

export async function getReview(
  reviewId_: string,
  userId?: string,
  userRoles?: string[]
): Promise<Record<string, unknown>> {
  const oid = reviewId(reviewId_);
  const reviews = getCollection('reviews');
  const review = await reviews.findOne({ _id: oid }) as any;
  if (!review) throw new NotFoundError('Review not found');

  const isModerator = userRoles ? hasRole(userRoles, 'moderator') : false;

  // Removed content is only visible to moderators/admins
  if (review.state === 'removed' && !isModerator) {
    throw new NotFoundError('Review not found');
  }

  // Collapsed content is accessible to any authenticated user
  // (state is returned as-is; callers can render it differently)

  return review;
}

// ── List Reviews ──────────────────────────────────────────────────────────────

export async function listReviews(
  roomId: string,
  filters: {
    state?: string;
    pinned?: boolean;
    authorId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    isStaff?: boolean;
  },
  page: number,
  pageSize: number
): Promise<{ data: unknown[]; total: number }> {
  const reviews = getCollection('reviews');
  const query: Record<string, unknown> = { roomId };

  // Non-staff can only see visible/collapsed
  if (!filters.isStaff) {
    query.state = filters.state && ['visible', 'collapsed'].includes(filters.state)
      ? filters.state
      : { $in: ['visible', 'collapsed'] };
  } else if (filters.state) {
    query.state = filters.state;
  }

  if (filters.pinned !== undefined) query.isPinned = filters.pinned;
  if (filters.authorId) query.userId = filters.authorId;

  if (filters.dateFrom || filters.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (filters.dateFrom) dateFilter.$gte = filters.dateFrom;
    if (filters.dateTo) dateFilter.$lte = filters.dateTo;
    query.createdAt = dateFilter;
  }

  const total = await reviews.countDocuments(query);
  const reviewDocs = await reviews
    .find(query)
    .sort({ isPinned: -1, createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as any[];

  // Batch-fetch media for all returned reviews
  const reviewIds = reviewDocs.map((r: any) => r._id.toString());
  const allMedia = await getCollection('review_media')
    .find({ reviewId: { $in: reviewIds } } as any)
    .sort({ createdAt: 1 })
    .toArray() as any[];

  const mediaByReview = new Map<string, any[]>();
  for (const m of allMedia) {
    const rid = m.reviewId;
    if (!mediaByReview.has(rid)) mediaByReview.set(rid, []);
    mediaByReview.get(rid)!.push({
      _id: m._id.toString(),
      reviewId: m.reviewId,
      originalName: m.originalName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      sha256Hash: m.sha256Hash,
      createdAt: m.createdAt,
    });
  }

  // Batch-fetch author display data
  const authorIds = [...new Set(reviewDocs.map((r: any) => r.userId))];
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

  const data = reviewDocs.map((r: any) => ({
    ...r,
    author: authorMap.get(r.userId) || { _id: r.userId, displayName: 'Unknown' },
    media: mediaByReview.get(r._id.toString()) || [],
  }));

  return { data, total };
}

// ── Review Media ──────────────────────────────────────────────────────────────

export interface ReviewMediaFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function addReviewMedia(
  reviewId_: string,
  userId: string,
  files: ReviewMediaFile[]
): Promise<Record<string, unknown>[]> {
  const oid = reviewId(reviewId_);
  const reviews = getCollection('reviews');
  const review = await reviews.findOne({ _id: oid }) as any;
  if (!review) throw new NotFoundError('Review not found');
  if (review.userId !== userId) throw new ForbiddenError('You can only add media to your own reviews');

  // Count existing media
  const mediaCol = getCollection('review_media');
  const existingCount = await mediaCol.countDocuments({ reviewId: reviewId_ });
  if (existingCount + files.length > REVIEW_MAX_IMAGES) {
    throw new ValidationError(
      `Cannot exceed ${REVIEW_MAX_IMAGES} images per review. Already have ${existingCount}.`
    );
  }

  const results: Record<string, unknown>[] = [];

  for (const file of files) {
    // Validate MIME type
    if (!(REVIEW_ALLOWED_MIME_TYPES as string[]).includes(file.mimetype)) {
      throw new ValidationError(
        `Unsupported file type '${file.mimetype}'. Allowed types: ${REVIEW_ALLOWED_MIME_TYPES.join(', ')}`
      );
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      throw new ValidationError('File exceeds maximum size of 10MB');
    }

    // Validate magic bytes
    if (!checkMagicBytes(file.buffer, file.mimetype)) {
      throw new ValidationError(
        `File content does not match declared MIME type (magic bytes mismatch) for ${file.originalname}`
      );
    }

    // Compute hash and encrypt
    const sha256Hash = hashSha256(file.buffer);
    ensureReviewUploadDir();
    const { encrypted, iv, tag } = encryptFileBuffer(file.buffer);
    const fileName = `${sha256Hash}.enc`;
    const storagePath = path.join(REVIEW_UPLOAD_DIR, fileName);
    if (!fs.existsSync(storagePath)) {
      fs.writeFileSync(storagePath, encrypted);
    }

    const now = new Date();
    const doc = {
      reviewId: reviewId_,
      uploadedByUserId: userId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256Hash,
      storagePath,
      encryptionIv: iv,
      encryptionTag: tag,
      createdAt: now,
    };

    const result = await mediaCol.insertOne(doc as any);
    results.push({
      _id: result.insertedId.toString(),
      reviewId: reviewId_,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256Hash,
      createdAt: now,
    });
  }

  return results;
}

export async function getReviewMedia(
  reviewId_: string,
  userId?: string,
  userRoles?: string[]
): Promise<Record<string, unknown>[]> {
  const reviews = getCollection('reviews');
  const review = await reviews.findOne({ _id: reviewId(reviewId_) }) as any;
  if (!review) throw new NotFoundError('Review not found');

  const isModerator = userRoles ? hasRole(userRoles, 'moderator') : false;

  // Media for removed reviews is only accessible to moderators/admins
  if (review.state === 'removed' && !isModerator) {
    throw new NotFoundError('Review not found');
  }

  const mediaCol = getCollection('review_media');
  const docs = await mediaCol
    .find({ reviewId: reviewId_ })
    .sort({ createdAt: 1 })
    .toArray() as any[];

  return docs.map((doc) => ({
    _id: doc._id.toString(),
    reviewId: doc.reviewId,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    sha256Hash: doc.sha256Hash,
    createdAt: doc.createdAt,
  }));
}

// ── Download Review Media ─────────────────────────────────────────────────────

export async function downloadReviewMedia(
  reviewId_: string,
  mediaId: string,
  userId?: string,
  userRoles?: string[]
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  // Check parent review visibility
  const reviews = getCollection('reviews');
  const review = await reviews.findOne({ _id: reviewId(reviewId_) }) as any;
  if (!review) throw new NotFoundError('Review not found');

  const isModerator = userRoles ? hasRole(userRoles, 'moderator') : false;

  // Media for removed reviews is only accessible to moderators/admins
  if (review.state === 'removed' && !isModerator) {
    throw new NotFoundError('Review not found');
  }

  const mediaCol = getCollection('review_media');

  let mediaOid: ObjectId;
  try {
    mediaOid = new ObjectId(mediaId);
  } catch {
    throw new ValidationError('Invalid media id');
  }

  const doc = await mediaCol.findOne({ _id: mediaOid }) as any;
  if (!doc) throw new NotFoundError('Media not found');

  // Verify it belongs to the given review
  if (doc.reviewId !== reviewId_) {
    throw new NotFoundError('Media not found for this review');
  }

  if (!fs.existsSync(doc.storagePath)) {
    throw new NotFoundError('Media file not found on disk');
  }

  const encryptedBuffer = fs.readFileSync(doc.storagePath);
  const buffer = decryptFileBuffer(encryptedBuffer, doc.encryptionIv, doc.encryptionTag);

  return {
    buffer,
    mimeType: doc.mimeType,
    filename: doc.originalName,
  };
}

// ── Feature Review ────────────────────────────────────────────────────────────

export async function featureReview(
  reviewId_: string,
  featured: boolean,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  if (!hasRole(userRoles, 'moderator')) {
    throw new ForbiddenError('Moderator or administrator access required');
  }

  const oid = reviewId(reviewId_);
  const reviews = getCollection('reviews');
  const review = await reviews.findOne({ _id: oid }) as any;
  if (!review) throw new NotFoundError('Review not found');

  const updated = await reviews.findOneAndUpdate(
    { _id: oid },
    { $set: { featured, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' }
  ) as any;

  await writeAuditLog({
    actorUserId: userId,
    actorRole: userRoles.includes('administrator') ? 'administrator' : 'moderator',
    action: featured ? 'review.feature' : 'review.unfeature',
    objectType: 'review',
    objectId: reviewId_,
    oldValue: { featured: review.featured },
    newValue: { featured },
    requestId: '',
  });

  return updated;
}
