import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { writeAuditLog } from './audit.service';
import { ValidationError, ConflictError, NotFoundError } from './auth.service';

interface MembershipTierDoc {
  _id: ObjectId;
  name: string;
  description: string;
  benefits: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

interface MembershipAccountDoc {
  _id: ObjectId;
  userId: string;
  tierId: string | null;
  pointsBalance: number;
  walletBalanceCents: number;
  isBlacklisted: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export async function getMembershipAccount(userId: string): Promise<MembershipAccountDoc> {
  const col = getCollection<MembershipAccountDoc>('membership_accounts');
  let account = await col.findOne({ userId } as any);

  if (!account) {
    // Auto-create account on first access
    const now = new Date();
    const result = await col.insertOne({
      userId,
      tierId: null,
      pointsBalance: 0,
      walletBalanceCents: 0,
      isBlacklisted: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
    } as any);
    account = await col.findOne({ _id: result.insertedId });
  }

  return account as unknown as MembershipAccountDoc;
}

export async function listMembershipTiers(): Promise<MembershipTierDoc[]> {
  const col = getCollection<MembershipTierDoc>('membership_tiers');
  return col.find({ isActive: true } as any).sort({ name: 1 }).toArray() as unknown as MembershipTierDoc[];
}

export async function createTier(
  name: string,
  description: string,
  benefits: Record<string, unknown>,
  performedByUserId: string
): Promise<MembershipTierDoc> {
  if (!name || name.trim().length === 0) throw new ValidationError('Tier name is required');
  if (!description || description.trim().length === 0) throw new ValidationError('Tier description is required');

  const col = getCollection<MembershipTierDoc>('membership_tiers');
  const existing = await col.findOne({ name: name.trim() } as any);
  if (existing) throw new ConflictError('A tier with this name already exists');

  const now = new Date();
  const doc: Omit<MembershipTierDoc, '_id'> = {
    name: name.trim(),
    description: description.trim(),
    benefits: benefits || {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await col.insertOne(doc as any);
  const created = await col.findOne({ _id: result.insertedId });

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'tier.create',
    objectType: 'membership_tier',
    objectId: result.insertedId.toString(),
    newValue: doc as Record<string, unknown>,
    requestId: '',
  });

  return created as unknown as MembershipTierDoc;
}

export async function updateTier(
  tierId: string,
  updates: Partial<Pick<MembershipTierDoc, 'name' | 'description' | 'benefits' | 'isActive'>>,
  version: number,
  performedByUserId: string
): Promise<MembershipTierDoc> {
  const col = getCollection<MembershipTierDoc>('membership_tiers');
  let oid: ObjectId;
  try {
    oid = new ObjectId(tierId);
  } catch {
    throw new ValidationError('Invalid tier ID');
  }

  const existing = await col.findOne({ _id: oid } as any);
  if (!existing) throw new NotFoundError('Membership tier not found');
  if ((existing as any).version !== version) {
    throw new ConflictError('Tier was modified by another request. Reload and retry.');
  }

  const now = new Date();
  const setFields: Record<string, unknown> = { updatedAt: now };
  if (updates.name !== undefined) setFields.name = updates.name.trim();
  if (updates.description !== undefined) setFields.description = updates.description.trim();
  if (updates.benefits !== undefined) setFields.benefits = updates.benefits;
  if (updates.isActive !== undefined) setFields.isActive = updates.isActive;

  const result = await col.findOneAndUpdate(
    { _id: oid, version } as any,
    { $set: setFields, $inc: { version: 1 } } as any,
    { returnDocument: 'after' }
  );

  if (!result) throw new ConflictError('Concurrent modification detected. Reload and retry.');

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'tier.update',
    objectType: 'membership_tier',
    objectId: tierId,
    oldValue: existing as unknown as Record<string, unknown>,
    newValue: result as unknown as Record<string, unknown>,
    requestId: '',
  });

  return result as unknown as MembershipTierDoc;
}

export async function assignTier(
  userId: string,
  tierId: string | null,
  performedByUserId: string
): Promise<MembershipAccountDoc> {
  if (tierId !== null) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(tierId);
    } catch {
      throw new ValidationError('Invalid tier ID');
    }
    const tierCol = getCollection<MembershipTierDoc>('membership_tiers');
    const tier = await tierCol.findOne({ _id: oid, isActive: true } as any);
    if (!tier) throw new NotFoundError('Membership tier not found or inactive');
  }

  const account = await getMembershipAccount(userId);
  const col = getCollection<MembershipAccountDoc>('membership_accounts');
  const now = new Date();

  const updated = await col.findOneAndUpdate(
    { userId } as any,
    { $set: { tierId, updatedAt: now }, $inc: { version: 1 } } as any,
    { returnDocument: 'after' }
  );

  await writeAuditLog({
    actorUserId: performedByUserId,
    actorRole: 'administrator',
    action: 'membership.assign_tier',
    objectType: 'membership_account',
    objectId: account._id.toString(),
    oldValue: { tierId: account.tierId },
    newValue: { tierId },
    requestId: '',
  });

  return updated as unknown as MembershipAccountDoc;
}

export async function listMemberAccounts(
  filters: { search?: string },
  page: number,
  pageSize: number
): Promise<{ members: Record<string, unknown>[]; total: number }> {
  const accountsCol = getCollection<MembershipAccountDoc>('membership_accounts');
  const usersCol = getCollection('users');
  const tiersCol = getCollection<MembershipTierDoc>('membership_tiers');

  // Build user-level match for search
  let matchedUserIds: string[] | null = null;
  if (filters.search && filters.search.trim().length > 0) {
    const searchRx = new RegExp(filters.search.trim(), 'i');
    const matchedUsers = await usersCol
      .find({ $or: [{ username: searchRx }, { displayName: searchRx }] } as any)
      .project({ _id: 1 })
      .toArray();
    matchedUserIds = matchedUsers.map((u: any) => String(u._id));
  }

  const query: Record<string, unknown> = {};
  if (matchedUserIds !== null) {
    query.userId = { $in: matchedUserIds };
  }

  const skip = (page - 1) * pageSize;
  const [docs, total] = await Promise.all([
    accountsCol.find(query as any).sort({ createdAt: -1 }).skip(skip).limit(pageSize).toArray(),
    accountsCol.countDocuments(query as any),
  ]);

  // Fetch related users and tiers in bulk
  const userIds = (docs as any[]).map((d) => d.userId).filter(Boolean);
  const tierIds = (docs as any[]).map((d) => d.tierId).filter(Boolean);

  const [userDocs, tierDocs] = await Promise.all([
    userIds.length > 0
      ? usersCol.find({ _id: { $in: userIds.map((id: string) => { try { return new ObjectId(id); } catch { return id; } }) } } as any).toArray()
      : Promise.resolve([]),
    tierIds.length > 0
      ? tiersCol.find({ _id: { $in: tierIds.map((id: string) => { try { return new ObjectId(id); } catch { return id; } }) } } as any).toArray()
      : Promise.resolve([]),
  ]);

  const userMap: Record<string, any> = {};
  for (const u of userDocs as any[]) {
    userMap[String(u._id)] = u;
  }
  const tierMap: Record<string, any> = {};
  for (const t of tierDocs as any[]) {
    tierMap[String(t._id)] = t;
  }

  const members = (docs as any[]).map((d) => {
    const user = userMap[d.userId] || null;
    const tier = d.tierId ? tierMap[d.tierId] || null : null;
    return {
      _id: String(d._id),
      userId: d.userId,
      username: user?.username || '',
      displayName: user?.displayName || '',
      tierId: d.tierId || null,
      tierName: tier?.name || null,
      balanceCents: d.walletBalanceCents ?? 0,
      pointsBalance: d.pointsBalance ?? 0,
      isBlacklisted: d.isBlacklisted ?? false,
      createdAt: d.createdAt,
    };
  });

  return { members, total };
}

export async function getUserMembership(userId: string): Promise<{
  account: MembershipAccountDoc;
  tier: MembershipTierDoc | null;
}> {
  const account = await getMembershipAccount(userId);

  let tier: MembershipTierDoc | null = null;
  if (account.tierId) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(account.tierId);
      const col = getCollection<MembershipTierDoc>('membership_tiers');
      tier = (await col.findOne({ _id: oid } as any)) as unknown as MembershipTierDoc;
    } catch {
      // tierId invalid, return null tier
    }
  }

  return { account, tier };
}
