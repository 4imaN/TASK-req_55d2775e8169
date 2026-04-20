import { ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getCollection } from '../config/db';
import { logger } from '../utils/logger';

// ── Retention constants ────────────────────────────────────────────────────────

const FACE_EVENT_TTL_DAYS = 30;
const SESSION_TERMINAL_TTL_DAYS = 30;
const NOTIFICATION_TTL_DAYS = 90;
const ATTACHMENT_ORPHAN_HOURS = 24;
const USER_ANONYMIZE_DAYS = 30;

const TERMINAL_SESSION_STATUSES = ['revoked', 'expired_idle', 'expired_absolute'];

// ── purgeExpiredFaceEvents ─────────────────────────────────────────────────────
// Backup to MongoDB TTL index – deletes face_events past 30-day TTL
export async function purgeExpiredFaceEvents(): Promise<number> {
  const col = getCollection('face_events');
  const cutoff = new Date(Date.now() - FACE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const result = await col.deleteMany({
    $or: [
      { expiresAt: { $lte: new Date() } },
      { occurredAt: { $lte: cutoff } },
    ],
  } as any);

  if (result.deletedCount > 0) {
    logger.info('retention', { job: 'purgeExpiredFaceEvents', deleted: result.deletedCount });
  }

  return result.deletedCount;
}

// ── purgeExpiredSessions ───────────────────────────────────────────────────────
// Deletes sessions past 30 days after terminal state (revoked / expired)
export async function purgeExpiredSessions(): Promise<number> {
  const col = getCollection('sessions');
  const cutoff = new Date(Date.now() - SESSION_TERMINAL_TTL_DAYS * 24 * 60 * 60 * 1000);

  const result = await col.deleteMany({
    status: { $in: TERMINAL_SESSION_STATUSES },
    updatedAt: { $lte: cutoff },
  } as any);

  if (result.deletedCount > 0) {
    logger.info('retention', { job: 'purgeExpiredSessions', deleted: result.deletedCount });
  }

  return result.deletedCount;
}

// ── purgeExpiredNotifications ──────────────────────────────────────────────────
// Deletes notifications past 90 days after read or expiry
export async function purgeExpiredNotifications(): Promise<number> {
  const col = getCollection('notifications');
  const cutoff = new Date(Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const result = await col.deleteMany({
    $or: [
      // Read more than 90 days ago
      { readAt: { $lte: cutoff } },
      // Expired (dueAt past) more than 90 days ago
      { dueAt: { $lte: cutoff } },
    ],
  } as any);

  if (result.deletedCount > 0) {
    logger.info('retention', { job: 'purgeExpiredNotifications', deleted: result.deletedCount });
  }

  return result.deletedCount;
}

// ── purgeExpiredShareLinks ─────────────────────────────────────────────────────
// Deletes reservation_share_links past expiry date
export async function purgeExpiredShareLinks(): Promise<number> {
  const col = getCollection('reservation_share_links');
  const now = new Date();

  const result = await col.deleteMany({
    expiresAt: { $lte: now },
  } as any);

  if (result.deletedCount > 0) {
    logger.info('retention', { job: 'purgeExpiredShareLinks', deleted: result.deletedCount });
  }

  return result.deletedCount;
}

// ── purgeOrphanAttachments ─────────────────────────────────────────────────────
// Deletes attachments not linked to any existing parent after 24 hours,
// removes blob files from disk
export async function purgeOrphanAttachments(): Promise<number> {
  const attachCol = getCollection('attachments');
  const cutoff = new Date(Date.now() - ATTACHMENT_ORPHAN_HOURS * 60 * 60 * 1000);

  // Find old attachments
  const candidates = await attachCol
    .find({ createdAt: { $lte: cutoff } } as any)
    .toArray() as any[];

  let purged = 0;

  for (const attachment of candidates) {
    const parentType: string = attachment.parentType;
    const parentId: string = attachment.parentId;

    // Map parentType to collection name
    const collectionMap: Record<string, string> = {
      lead: 'leads',
      review: 'reviews',
      reservation: 'reservations',
      qa_post: 'qa_posts',
    };

    const parentCollection = collectionMap[parentType];
    if (!parentCollection) continue;

    // Check if parent exists
    let parentExists = false;
    try {
      const parentDoc = await getCollection(parentCollection).findOne({
        _id: new ObjectId(parentId),
      } as any);
      parentExists = !!parentDoc;
    } catch {
      // If ID is invalid, parent does not exist
      parentExists = false;
    }

    if (!parentExists) {
      // Delete the metadata record first
      await attachCol.deleteOne({ _id: attachment._id } as any);

      // Only remove the blob file if no other attachment references the same hash
      if (attachment.storagePath && attachment.sha256Hash) {
        const remaining = await attachCol.countDocuments({ sha256Hash: attachment.sha256Hash } as any);
        if (remaining === 0) {
          try {
            if (fs.existsSync(attachment.storagePath)) {
              fs.unlinkSync(attachment.storagePath);
            }
          } catch (fsErr: any) {
            logger.error('retention', {
              job: 'purgeOrphanAttachments',
              action: 'unlink',
              storagePath: attachment.storagePath,
              error: fsErr.message,
            });
          }
        }
      }

      purged++;
    }
  }

  if (purged > 0) {
    logger.info('retention', { job: 'purgeOrphanAttachments', deleted: purged });
  }

  return purged;
}

// ── anonymizeDeletedUsers ──────────────────────────────────────────────────────
// Finds soft-deleted users older than 30 days, anonymizes non-financial/non-audit
// profile data (replace username with anon_<hash>, clear displayName, phone, etc)
export async function anonymizeDeletedUsers(): Promise<number> {
  const usersCol = getCollection('users');
  const cutoff = new Date(Date.now() - USER_ANONYMIZE_DAYS * 24 * 60 * 60 * 1000);

  // Find soft-deleted users that have not yet been anonymized
  const deletedUsers = await usersCol
    .find({
      isDeleted: true,
      deletedAt: { $lte: cutoff },
      anonymizedAt: { $exists: false }, // Guard: don't re-anonymize
    } as any)
    .toArray() as any[];

  let anonymized = 0;

  for (const user of deletedUsers) {
    const userId = user._id.toString();

    // Create a stable deterministic hash for the anon username
    const anonHash = crypto
      .createHash('sha256')
      .update(userId)
      .digest('hex')
      .slice(0, 12);

    const anonUsername = `anon_${anonHash}`;

    try {
      await usersCol.updateOne(
        { _id: user._id } as any,
        {
          $set: {
            username: anonUsername,
            username_ci: anonUsername.toLowerCase(),
            displayName: 'Deleted User',
            phone: null,
            phoneEncrypted: null,
            avatarUrl: null,
            bio: null,
            notificationPreferences: {},
            anonymizedAt: new Date(),
            updatedAt: new Date(),
          },
          $unset: {
            passwordHash: '',
            totpSecret: '',
            faceEnrollmentId: '',
          },
        } as any
      );

      // Remove face enrollments for privacy
      await getCollection('face_enrollments').deleteMany({
        userId: userId,
      } as any);

      anonymized++;

      logger.info('retention', { job: 'anonymizeDeletedUsers', userId, anonUsername });
    } catch (err: any) {
      logger.error('retention', { job: 'anonymizeDeletedUsers', userId, error: err.message });
    }
  }

  return anonymized;
}
