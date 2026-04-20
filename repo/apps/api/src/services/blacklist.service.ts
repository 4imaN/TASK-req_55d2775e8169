import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { writeAuditLog } from './audit.service';
import { ValidationError, NotFoundError } from './auth.service';
import { getMembershipAccount } from './membership.service';
import {
  BLACKLIST_NOSHOW_THRESHOLD,
  BLACKLIST_NOSHOW_WINDOW_DAYS,
  BLACKLIST_DISPUTE_THRESHOLD,
  BLACKLIST_DISPUTE_WINDOW_DAYS,
} from '@studyroomops/shared-policy';

export interface BlacklistActionDoc {
  _id: ObjectId;
  userId: string;
  triggeredBy: 'auto_noshow' | 'auto_dispute' | 'manual';
  reason: string;
  performedByUserId: string | null; // null for auto
  expiresAt?: Date | null;
  clearedAt: Date | null;
  clearedByUserId: string | null;
  createdAt: Date;
}

// ── isBlacklisted ─────────────────────────────────────────────────────────────
export async function isBlacklisted(userId: string): Promise<boolean> {
  const account = await getMembershipAccount(userId);
  if (!account.isBlacklisted) return false;

  // Check whether the active blacklist entry has expired
  const actionCol = getCollection('blacklist_actions');
  const activeAction = await actionCol.findOne({ userId, clearedAt: null } as any) as any;
  if (activeAction && activeAction.expiresAt && new Date() > new Date(activeAction.expiresAt)) {
    // Expired — auto-clear the blacklist
    const now = new Date();
    await actionCol.updateOne(
      { _id: activeAction._id } as any,
      { $set: { clearedAt: now, clearedByUserId: 'system' } } as any
    );
    const accCol = getCollection('membership_accounts');
    await accCol.updateOne(
      { userId } as any,
      { $set: { isBlacklisted: false, updatedAt: now } } as any
    );
    return false;
  }

  return true;
}

// ── checkAutoBlacklist ────────────────────────────────────────────────────────
export async function checkAutoBlacklist(userId: string): Promise<void> {
  // Already blacklisted – skip
  const account = await getMembershipAccount(userId);
  if (account.isBlacklisted) return;

  const now = new Date();

  // Check no-show threshold
  const noshowWindowStart = new Date(now.getTime() - BLACKLIST_NOSHOW_WINDOW_DAYS * 24 * 3600 * 1000);
  const resCol = getCollection('reservations');
  const noshowCount = await resCol.countDocuments({
    userId,
    status: 'expired_no_show',
    updatedAt: { $gte: noshowWindowStart },
  } as any);

  if (noshowCount >= BLACKLIST_NOSHOW_THRESHOLD) {
    await applyBlacklist(userId, 'auto_noshow', `Auto-blacklisted: ${noshowCount} no-shows in ${BLACKLIST_NOSHOW_WINDOW_DAYS} days`, null);
    return;
  }

  // Check dispute threshold
  const disputeWindowStart = new Date(now.getTime() - BLACKLIST_DISPUTE_WINDOW_DAYS * 24 * 3600 * 1000);
  const disputeCol = getCollection('charge_disputes');
  const disputeCount = await disputeCol.countDocuments({
    userId,
    status: 'resolved_user', // resolved in user's favor = confirmed charge dispute
    updatedAt: { $gte: disputeWindowStart },
  } as any);

  if (disputeCount >= BLACKLIST_DISPUTE_THRESHOLD) {
    await applyBlacklist(userId, 'auto_dispute', `Auto-blacklisted: ${disputeCount} confirmed disputes in ${BLACKLIST_DISPUTE_WINDOW_DAYS} days`, null);
  }
}

// ── Internal: apply blacklist ─────────────────────────────────────────────────
async function applyBlacklist(
  userId: string,
  triggeredBy: 'auto_noshow' | 'auto_dispute' | 'manual',
  reason: string,
  performedByUserId: string | null,
  expiresAt?: Date
): Promise<void> {
  const now = new Date();
  const actionCol = getCollection('blacklist_actions');

  await actionCol.insertOne({
    userId,
    triggeredBy,
    reason,
    performedByUserId,
    expiresAt: expiresAt ?? null,
    clearedAt: null,
    clearedByUserId: null,
    createdAt: now,
  } as any);

  const accCol = getCollection('membership_accounts');
  await accCol.updateOne(
    { userId } as any,
    { $set: { isBlacklisted: true, updatedAt: now } } as any
  );

  await writeAuditLog({
    actorUserId: performedByUserId ?? 'system',
    actorRole: performedByUserId ? 'administrator' : 'system',
    action: 'blacklist.apply',
    objectType: 'membership_account',
    objectId: userId,
    newValue: { triggeredBy, reason },
    requestId: '',
  });
}

// ── manualBlacklist ───────────────────────────────────────────────────────────
export async function manualBlacklist(
  userId: string,
  reason: string,
  performedByUserId: string,
  expiresAt?: Date
): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError('Reason is required for manual blacklist');
  }

  const account = await getMembershipAccount(userId);
  if (account.isBlacklisted) {
    throw new ValidationError('User is already blacklisted');
  }

  await applyBlacklist(userId, 'manual', reason.trim(), performedByUserId, expiresAt);
}

// ── clearBlacklist ────────────────────────────────────────────────────────────
export async function clearBlacklist(userId: string, performedByUserId: string): Promise<void> {
  const account = await getMembershipAccount(userId);
  if (!account.isBlacklisted) {
    throw new ValidationError('User is not currently blacklisted');
  }

  const now = new Date();
  const actionCol = getCollection('blacklist_actions');

  // Clear most recent active blacklist entry
  await actionCol.updateOne(
    { userId, clearedAt: null } as any,
    { $set: { clearedAt: now, clearedByUserId: performedByUserId } } as any
  );

  const accCol = getCollection('membership_accounts');
  await accCol.updateOne(
    { userId } as any,
    { $set: { isBlacklisted: false, updatedAt: now } } as any
  );

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'blacklist.clear',
    objectType: 'membership_account',
    objectId: userId,
    newValue: { clearedAt: now },
    requestId: '',
  });
}

// ── listBlacklistActions ──────────────────────────────────────────────────────
export async function listBlacklistActions(
  filters: { userId?: string; triggeredBy?: string; active?: boolean },
  page: number,
  pageSize: number
): Promise<{ actions: BlacklistActionDoc[]; total: number }> {
  const col = getCollection('blacklist_actions');
  const query: Record<string, unknown> = {};

  if (filters.userId) query.userId = filters.userId;
  if (filters.triggeredBy) query.triggeredBy = filters.triggeredBy;
  if (filters.active === true) query.clearedAt = null;
  if (filters.active === false) query.clearedAt = { $ne: null };

  const total = await col.countDocuments(query as any);
  const actions = await col
    .find(query as any)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as BlacklistActionDoc[];

  return { actions, total };
}
