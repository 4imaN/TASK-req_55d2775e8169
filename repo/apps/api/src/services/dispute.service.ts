import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { writeAuditLog } from './audit.service';
import { ValidationError, ConflictError, NotFoundError } from './auth.service';
import { checkAutoBlacklist } from './blacklist.service';
import { refund } from './wallet.service';
import { DISPUTE_STATE_TRANSITIONS } from '@studyroomops/shared-policy';

export interface DisputeDoc {
  _id: ObjectId;
  userId: string;
  ledgerEntryId: string;
  reason: string;
  status: string;
  resolvedByUserId: string | null;
  internalNotes: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ── createDispute ─────────────────────────────────────────────────────────────
export async function createDispute(
  userId: string,
  ledgerEntryId: string,
  reason: string,
  idempotencyKey: string
): Promise<DisputeDoc> {
  if (!reason || reason.trim().length < 10) {
    throw new ValidationError('Dispute reason must be at least 10 characters');
  }

  // Idempotency check
  const disputeCol = getCollection('charge_disputes');
  const existingByKey = await disputeCol.findOne({ idempotencyKey, userId } as any) as unknown as DisputeDoc | null;
  if (existingByKey) return existingByKey;

  // Validate ledger entry belongs to user
  let oid: ObjectId;
  try {
    oid = new ObjectId(ledgerEntryId);
  } catch {
    throw new ValidationError('Invalid ledger entry ID');
  }

  const entryCol = getCollection('ledger_entries');
  const entry = await entryCol.findOne({ _id: oid, userId } as any);
  if (!entry) throw new NotFoundError('Ledger entry not found or does not belong to user');

  // One open dispute per entry
  const existing = await disputeCol.findOne({
    ledgerEntryId,
    userId,
    status: { $in: ['open', 'under_review'] },
  } as any);
  if (existing) throw new ConflictError('An open dispute already exists for this ledger entry');

  const now = new Date();
  const result = await disputeCol.insertOne({
    userId,
    ledgerEntryId,
    reason: reason.trim(),
    status: 'open',
    resolvedByUserId: null,
    internalNotes: null,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as any);

  await writeAuditLog({
    actorUserId: userId,
    actorRole: 'member',
    action: 'dispute.create',
    objectType: 'charge_dispute',
    objectId: result.insertedId.toString(),
    newValue: { ledgerEntryId, reason },
    requestId: '',
  });

  return disputeCol.findOne({ _id: result.insertedId }) as unknown as DisputeDoc;
}

// ── updateDisputeStatus ───────────────────────────────────────────────────────
export async function updateDisputeStatus(
  disputeId: string,
  newStatus: string,
  resolvedByUserId: string,
  internalNotes?: string
): Promise<DisputeDoc> {
  let oid: ObjectId;
  try {
    oid = new ObjectId(disputeId);
  } catch {
    throw new ValidationError('Invalid dispute ID');
  }

  const disputeCol = getCollection('charge_disputes');
  const dispute = await disputeCol.findOne({ _id: oid } as any) as unknown as DisputeDoc | null;
  if (!dispute) throw new NotFoundError('Dispute not found');

  const allowed = DISPUTE_STATE_TRANSITIONS[dispute.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(`Cannot transition dispute from '${dispute.status}' to '${newStatus}'`);
  }

  const now = new Date();
  const updated = await disputeCol.findOneAndUpdate(
    { _id: oid, version: dispute.version } as any,
    {
      $set: {
        status: newStatus,
        resolvedByUserId,
        internalNotes: internalNotes ?? dispute.internalNotes,
        updatedAt: now,
      },
      $inc: { version: 1 },
    } as any,
    { returnDocument: 'after' }
  ) as unknown as DisputeDoc;

  if (!updated) throw new ConflictError('Concurrent modification detected');

  await writeAuditLog({
    actorUserId: resolvedByUserId,
    actorRole: 'administrator',
    action: 'dispute.update_status',
    objectType: 'charge_dispute',
    objectId: disputeId,
    oldValue: { status: dispute.status },
    newValue: { status: newStatus, internalNotes },
    requestId: '',
  });

  // Terminal state actions
  const terminalStates = ['resolved_user', 'resolved_house', 'rejected'];
  if (terminalStates.includes(newStatus)) {
    // Auto-blacklist check on any terminal resolution
    await checkAutoBlacklist(dispute.userId).catch(() => {/* non-fatal */});
  }

  // If resolved in user's favor, issue a refund
  if (newStatus === 'resolved_user') {
    const entryCol = getCollection('ledger_entries');
    const entry = await entryCol.findOne({ _id: new ObjectId(dispute.ledgerEntryId) } as any) as any;
    if (entry && Math.abs(entry.amountCents) > 0) {
      const refundKey = `dispute:${disputeId}:refund`;
      await refund(
        dispute.userId,
        Math.abs(entry.amountCents),
        dispute.ledgerEntryId,
        `Dispute refund for entry ${dispute.ledgerEntryId}`,
        resolvedByUserId,
        refundKey
      ).catch(() => {/* non-fatal – log but don't break status update */});
    }
  }

  return updated;
}

// ── listDisputes ──────────────────────────────────────────────────────────────
export async function listDisputes(
  filters: { userId?: string; status?: string; startDate?: Date; endDate?: Date },
  page: number,
  pageSize: number
): Promise<{ disputes: DisputeDoc[]; total: number }> {
  const col = getCollection('charge_disputes');
  const query: Record<string, unknown> = {};

  if (filters.userId) query.userId = filters.userId;
  if (filters.status) query.status = filters.status;
  if (filters.startDate || filters.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (filters.startDate) dateFilter.$gte = filters.startDate;
    if (filters.endDate) dateFilter.$lte = filters.endDate;
    query.createdAt = dateFilter;
  }

  const total = await col.countDocuments(query as any);
  const disputes = await col
    .find(query as any)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as DisputeDoc[];

  return { disputes, total };
}

// ── getDispute ────────────────────────────────────────────────────────────────
export async function getDispute(disputeId: string): Promise<DisputeDoc> {
  let oid: ObjectId;
  try {
    oid = new ObjectId(disputeId);
  } catch {
    throw new ValidationError('Invalid dispute ID');
  }

  const col = getCollection('charge_disputes');
  const dispute = await col.findOne({ _id: oid } as any) as unknown as DisputeDoc | null;
  if (!dispute) throw new NotFoundError('Dispute not found');

  return dispute;
}
