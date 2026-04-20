import { ObjectId, ClientSession } from 'mongodb';
import { getCollection, getClient } from '../config/db';
import { config, siteNow } from '../config';
import { writeAuditLog } from './audit.service';
import { ValidationError, NotFoundError } from './auth.service';
import {
  POINTS_REDEMPTION_BLOCK,
  DEFAULT_REDEMPTION_VALUE_CENTS,
} from '@studyroomops/shared-policy';
import { getMembershipAccount } from './membership.service';

export type LedgerEntryType =
  | 'topup'
  | 'spend'
  | 'refund'
  | 'points_credit'
  | 'points_deduction';

export interface LedgerEntryDoc {
  _id: ObjectId;
  userId: string;
  type: LedgerEntryType;
  amountCents: number;          // positive = credit, negative = debit
  description: string;
  referenceType?: string;
  referenceId?: string;
  originalEntryId?: string;     // for refund entries
  idempotencyKey: string;
  performedByUserId: string;
  runningBalanceCents: number;  // balance after this entry
  createdAt: Date;
}

// ── Idempotency check ──────────────────────────────────────────────────────────
async function findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<LedgerEntryDoc | null> {
  const col = getCollection('ledger_entries');
  return col.findOne({ userId, idempotencyKey } as any) as unknown as LedgerEntryDoc | null;
}

// ── Daily risk usage ───────────────────────────────────────────────────────────
export async function getDailyRiskUsage(userId: string, session?: ClientSession): Promise<number> {
  const now = siteNow();
  const dayStart = now.startOf('day').toJSDate();
  const dayEnd = now.endOf('day').toJSDate();

  const col = getCollection('ledger_entries');
  const entries = await col
    .find({
      userId,
      type: { $in: ['topup', 'spend', 'refund'] },
      createdAt: { $gte: dayStart, $lte: dayEnd },
    } as any, { session })
    .toArray() as unknown as LedgerEntryDoc[];

  return entries.reduce((sum, e) => sum + Math.abs(e.amountCents), 0);
}

// ── Balance reconciliation ─────────────────────────────────────────────────────
export async function getBalance(userId: string, session?: ClientSession): Promise<number> {
  const col = getCollection('ledger_entries');
  const entries = await col
    .find({ userId } as any, { session })
    .sort({ createdAt: 1 })
    .toArray() as unknown as LedgerEntryDoc[];

  return entries.reduce((sum, e) => sum + e.amountCents, 0);
}

// ── Internal: append ledger entry ─────────────────────────────────────────────
async function appendEntry(entry: Omit<LedgerEntryDoc, '_id' | 'createdAt'>, session?: ClientSession): Promise<LedgerEntryDoc> {
  const col = getCollection('ledger_entries');
  const now = new Date();
  const result = await col.insertOne({
    ...entry,
    createdAt: now,
  } as any, { session });
  return col.findOne({ _id: result.insertedId }, { session }) as unknown as LedgerEntryDoc;
}

// ── Internal: update stored balance on membership_accounts ───────────────────
async function setStoredBalance(userId: string, newBalance: number, session?: ClientSession): Promise<void> {
  const col = getCollection('membership_accounts');
  await col.updateOne(
    { userId } as any,
    { $set: { walletBalanceCents: newBalance, updatedAt: new Date() } } as any,
    { session }
  );
}

// ── Top-up ────────────────────────────────────────────────────────────────────
export async function topUp(
  userId: string,
  amountCents: number,
  description: string,
  performedByUserId: string,
  idempotencyKey: string,
  requestId?: string
): Promise<{ balanceCents: number }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError('Amount must be a positive integer (cents)');
  }

  const existing = await findByIdempotencyKey(userId, idempotencyKey);
  if (existing) {
    const bal = await getBalance(userId);
    return { balanceCents: bal };
  }

  let newBalance = 0;

  const client = getClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async (txSession) => {
      const dailyUsage = await getDailyRiskUsage(userId, txSession);
      const limit = config.wallet.dailyRiskLimitCents;
      if (dailyUsage + amountCents > limit) {
        throw new ValidationError(
          `Daily risk limit of ${limit} cents would be exceeded. Used: ${dailyUsage}, attempted: ${amountCents}`
        );
      }

      const currentBalance = await getBalance(userId, txSession);
      newBalance = currentBalance + amountCents;

      await appendEntry({
        userId,
        type: 'topup',
        amountCents,
        description,
        idempotencyKey,
        performedByUserId,
        runningBalanceCents: newBalance,
      }, txSession);

      await getMembershipAccount(userId);
      await setStoredBalance(userId, newBalance, txSession);
    });
  } catch (err: any) {
    // Handle duplicate-key as idempotent replay (concurrent request with same key)
    if (err.code === 11000 && err.message?.includes('idempotencyKey')) {
      await session.endSession();
      const bal = await getBalance(userId);
      return { balanceCents: bal };
    }
    await session.endSession();
    throw err;
  }
  await session.endSession();

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'wallet.topup',
    objectType: 'wallet',
    objectId: userId,
    newValue: { amountCents, newBalance, idempotencyKey },
    requestId: requestId || '',
  });

  return { balanceCents: newBalance };
}

// ── Spend ──────────────────────────────────────────────────────────────────────
export async function spend(
  userId: string,
  amountCents: number,
  description: string,
  referenceType: string | undefined,
  referenceId: string | undefined,
  performedByUserId: string,
  idempotencyKey: string,
  requestId?: string
): Promise<{ balanceCents: number; entryId: string }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError('Amount must be a positive integer (cents)');
  }

  const existing = await findByIdempotencyKey(userId, idempotencyKey);
  if (existing) {
    const bal = await getBalance(userId);
    return { balanceCents: bal, entryId: existing._id.toString() };
  }

  let newBalance = 0;
  let entryId = '';

  const client = getClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async (txSession) => {
      const currentBalance = await getBalance(userId, txSession);
      if (currentBalance < amountCents) {
        throw new ValidationError(`Insufficient balance. Balance: ${currentBalance} cents, requested: ${amountCents} cents`);
      }

      const dailyUsage = await getDailyRiskUsage(userId, txSession);
      const limit = config.wallet.dailyRiskLimitCents;
      if (dailyUsage + amountCents > limit) {
        throw new ValidationError(
          `Daily risk limit of ${limit} cents would be exceeded. Used: ${dailyUsage}, attempted: ${amountCents}`
        );
      }

      newBalance = currentBalance - amountCents;

      await getMembershipAccount(userId);

      const entry = await appendEntry({
        userId,
        type: 'spend',
        amountCents: -amountCents,
        description,
        referenceType,
        referenceId,
        idempotencyKey,
        performedByUserId,
        runningBalanceCents: newBalance,
      }, txSession);

      entryId = entry._id.toString();
      await setStoredBalance(userId, newBalance, txSession);
    });
  } catch (err: any) {
    if (err.code === 11000 && err.message?.includes('idempotencyKey')) {
      await session.endSession();
      const bal = await getBalance(userId);
      const dup = await findByIdempotencyKey(userId, idempotencyKey);
      return { balanceCents: bal, entryId: dup?._id.toString() || '' };
    }
    await session.endSession();
    throw err;
  }
  await session.endSession();

  // Award points for settled spend
  await awardPoints(userId, amountCents);

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'wallet.spend',
    objectType: 'wallet',
    objectId: userId,
    newValue: { amountCents, newBalance, referenceType, referenceId, idempotencyKey },
    requestId: requestId || '',
  });

  return { balanceCents: newBalance, entryId };
}

// ── Refund ────────────────────────────────────────────────────────────────────
export async function refund(
  userId: string,
  amountCents: number,
  originalEntryId: string,
  description: string,
  performedByUserId: string,
  idempotencyKey: string,
  requestId?: string
): Promise<{ balanceCents: number }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError('Refund amount must be a positive integer (cents)');
  }

  const existing = await findByIdempotencyKey(userId, idempotencyKey);
  if (existing) {
    const bal = await getBalance(userId);
    return { balanceCents: bal };
  }

  // Validate original entry before starting transaction
  const entryCol = getCollection('ledger_entries');
  let oid: ObjectId;
  try {
    oid = new ObjectId(originalEntryId);
  } catch {
    throw new ValidationError('Invalid original entry ID');
  }

  const originalEntry = await entryCol.findOne({ _id: oid, userId } as any) as unknown as LedgerEntryDoc | null;
  if (!originalEntry) throw new NotFoundError('Original ledger entry not found');
  if (!['spend', 'topup'].includes(originalEntry.type)) {
    throw new ValidationError('Can only refund spend or topup entries');
  }

  let newBalance = 0;

  const client = getClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async (txSession) => {
      const dailyUsage = await getDailyRiskUsage(userId, txSession);
      const limit = config.wallet.dailyRiskLimitCents;
      if (dailyUsage + amountCents > limit) {
        throw new ValidationError(
          `Daily risk limit of ${limit} cents would be exceeded. Used: ${dailyUsage}, attempted: ${amountCents}`
        );
      }

      const currentBalance = await getBalance(userId, txSession);
      newBalance = currentBalance + amountCents;

      await appendEntry({
        userId,
        type: 'refund',
        amountCents,
        description,
        originalEntryId,
        idempotencyKey,
        performedByUserId,
        runningBalanceCents: newBalance,
      }, txSession);

      await setStoredBalance(userId, newBalance, txSession);
    });
  } catch (err: any) {
    if (err.code === 11000 && err.message?.includes('idempotencyKey')) {
      await session.endSession();
      const bal = await getBalance(userId);
      return { balanceCents: bal };
    }
    await session.endSession();
    throw err;
  }
  await session.endSession();

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'wallet.refund',
    objectType: 'wallet',
    objectId: userId,
    newValue: { amountCents, originalEntryId, newBalance, idempotencyKey },
    requestId: requestId || '',
  });

  return { balanceCents: newBalance };
}

// ── Redeem Points ─────────────────────────────────────────────────────────────
export async function redeemPoints(
  userId: string,
  pointsToRedeem: number,
  performedByUserId: string,
  idempotencyKey: string,
  requestId?: string
): Promise<{ balanceCents: number; pointsBalance: number }> {
  if (!Number.isInteger(pointsToRedeem) || pointsToRedeem <= 0) {
    throw new ValidationError('Points to redeem must be a positive integer');
  }
  if (pointsToRedeem % POINTS_REDEMPTION_BLOCK !== 0) {
    throw new ValidationError(`Points must be redeemed in multiples of ${POINTS_REDEMPTION_BLOCK}`);
  }

  const deductKey = `${idempotencyKey}:deduct`;
  const creditKey = `${idempotencyKey}:credit`;

  const existingDeduct = await findByIdempotencyKey(userId, deductKey);
  if (existingDeduct) {
    const account = await getMembershipAccount(userId);
    const bal = await getBalance(userId);
    return { balanceCents: bal, pointsBalance: account.pointsBalance };
  }

  const account = await getMembershipAccount(userId);
  if (account.pointsBalance < pointsToRedeem) {
    throw new ValidationError(
      `Insufficient points. Balance: ${account.pointsBalance}, requested: ${pointsToRedeem}`
    );
  }

  const creditCents = Math.floor(pointsToRedeem / POINTS_REDEMPTION_BLOCK) * DEFAULT_REDEMPTION_VALUE_CENTS;
  const currentBalance = await getBalance(userId);
  const newWalletBalance = currentBalance + creditCents;
  const newPointsBalance = account.pointsBalance - pointsToRedeem;

  // Points deduction entry
  await appendEntry({
    userId,
    type: 'points_deduction',
    amountCents: 0, // doesn't affect wallet balance
    description: `Redeemed ${pointsToRedeem} points`,
    idempotencyKey: deductKey,
    performedByUserId,
    runningBalanceCents: currentBalance,
  });

  // Wallet credit entry
  await appendEntry({
    userId,
    type: 'points_credit',
    amountCents: creditCents,
    description: `Points redemption credit: ${pointsToRedeem} points = ${creditCents} cents`,
    idempotencyKey: creditKey,
    performedByUserId,
    runningBalanceCents: newWalletBalance,
  });

  // Update points balance
  const accCol = getCollection('membership_accounts');
  await accCol.updateOne(
    { userId } as any,
    {
      $set: {
        pointsBalance: newPointsBalance,
        walletBalanceCents: newWalletBalance,
        updatedAt: new Date(),
      },
    } as any
  );

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'member',
    action: 'wallet.redeem_points',
    objectType: 'wallet',
    objectId: userId,
    newValue: { pointsToRedeem, creditCents, newWalletBalance, newPointsBalance },
    requestId: requestId || '',
  });

  return { balanceCents: newWalletBalance, pointsBalance: newPointsBalance };
}

// ── Award Points ───────────────────────────────────────────────────────────────
// Called after a settled spend. Awards floor(spendCents/100) points.
export async function awardPoints(userId: string, spendEntryCents: number): Promise<void> {
  if (spendEntryCents <= 0) return;

  const points = Math.floor(spendEntryCents / 100);
  if (points === 0) return;

  const accCol = getCollection('membership_accounts');
  await getMembershipAccount(userId); // ensure exists
  await accCol.updateOne(
    { userId } as any,
    { $inc: { pointsBalance: points }, $set: { updatedAt: new Date() } } as any
  );
}

// ── Paginated Ledger ──────────────────────────────────────────────────────────
export async function getLedgerEntries(
  userId: string,
  filters: { type?: string; startDate?: Date; endDate?: Date },
  page: number,
  pageSize: number
): Promise<{ entries: LedgerEntryDoc[]; total: number }> {
  const col = getCollection('ledger_entries');
  const query: Record<string, unknown> = { userId };

  if (filters.type) query.type = filters.type;
  if (filters.startDate || filters.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (filters.startDate) dateFilter.$gte = filters.startDate;
    if (filters.endDate) dateFilter.$lte = filters.endDate;
    query.createdAt = dateFilter;
  }

  const total = await col.countDocuments(query as any);
  const entries = await col
    .find(query as any)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as LedgerEntryDoc[];

  return { entries, total };
}
