import { ObjectId } from 'mongodb';
import argon2 from 'argon2';
import { getCollection } from '../config/db';
import { config } from '../config';
import { encryptField, decryptField } from '../utils/crypto';
import {
  validateUsername,
  validatePassword,
  validatePhone,
  LOCKOUT_MAX_ATTEMPTS,
  LOCKOUT_WINDOW_MINUTES,
  LOCKOUT_DURATION_MINUTES,
} from '@studyroomops/shared-policy';

interface UserDoc {
  _id: ObjectId;
  username: string;
  username_ci: string;
  displayName: string;
  passwordHash: string;
  phoneEncrypted?: string;
  roles: string[];
  reputationTier: string;
  isActive: boolean;
  isDeleted: boolean;
  lockedUntil: Date | null;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface PublicUser {
  _id: string;
  username: string;
  displayName: string;
  phone?: string;
  roles: string[];
  reputationTier: string;
  isActive: boolean;
  createdAt: Date;
  version: number;
}

function toPublicUser(doc: UserDoc, isSelfOrAdmin: boolean): PublicUser {
  return {
    _id: doc._id.toString(),
    username: doc.username,
    displayName: doc.displayName,
    phone: isSelfOrAdmin && doc.phoneEncrypted ? decryptField(doc.phoneEncrypted) : undefined,
    roles: doc.roles,
    reputationTier: doc.reputationTier,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    version: doc.version,
  };
}

export async function register(
  username: string,
  password: string,
  displayName: string,
  phone?: string
): Promise<PublicUser> {
  const usernameErr = validateUsername(username);
  if (usernameErr) throw new ValidationError(usernameErr);

  const passwordErr = validatePassword(password);
  if (passwordErr) throw new ValidationError(passwordErr);

  if (phone) {
    const phoneErr = validatePhone(phone);
    if (phoneErr) throw new ValidationError(phoneErr);
  }

  if (!displayName || displayName.trim().length === 0) {
    throw new ValidationError('Display name is required');
  }

  const col = getCollection('users');

  // Check uniqueness
  const existing = await col.findOne({ username_ci: username.toLowerCase() });
  if (existing) throw new ConflictError('Username already taken');

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const now = new Date();
  const doc: Omit<UserDoc, '_id'> = {
    username: username.trim(),
    username_ci: username.toLowerCase().trim(),
    displayName: displayName.trim(),
    passwordHash,
    phoneEncrypted: phone ? encryptField(phone) : undefined,
    roles: [],
    reputationTier: 'New',
    isActive: true,
    isDeleted: false,
    lockedUntil: null,
    failedLoginAttempts: 0,
    lastFailedLoginAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await col.insertOne(doc as any);

  // Look up the default membership tier to get its real ObjectId
  const defaultTier = await getCollection('membership_tiers').findOne({ isDefault: true }) as any;

  // Create default membership account
  await getCollection('membership_accounts').insertOne({
    userId: result.insertedId.toString(),
    tierId: defaultTier?._id?.toString() || null,
    walletBalanceCents: 0,
    pointsBalance: 0,
    isBlacklisted: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as any);

  return toPublicUser({ ...doc, _id: result.insertedId } as UserDoc, true);
}

export async function login(
  username: string,
  password: string
): Promise<{ user: PublicUser }> {
  const col = getCollection('users');
  const doc = await col.findOne({ username_ci: username.toLowerCase().trim() }) as unknown as UserDoc | null;

  if (!doc || doc.isDeleted || !doc.isActive) {
    throw new AuthError('Invalid username or password');
  }

  // Check lockout
  const now = new Date();
  if (doc.lockedUntil && now < doc.lockedUntil) {
    throw new AuthError('Account is temporarily locked. Please try again later.');
  }

  // Verify password
  const valid = await argon2.verify(doc.passwordHash, password);
  if (!valid) {
    // Record failed attempt
    const windowStart = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * 60 * 1000);
    const recentFailures = doc.lastFailedLoginAt && doc.lastFailedLoginAt > windowStart
      ? doc.failedLoginAttempts + 1
      : 1;

    const update: Record<string, unknown> = {
      failedLoginAttempts: recentFailures,
      lastFailedLoginAt: now,
    };

    if (recentFailures >= LOCKOUT_MAX_ATTEMPTS) {
      update.lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
    }

    await col.updateOne({ _id: doc._id }, { $set: update });
    throw new AuthError('Invalid username or password');
  }

  // Reset failed attempts on successful login
  await col.updateOne(
    { _id: doc._id },
    { $set: { failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null } }
  );

  return { user: toPublicUser(doc, true) };
}

export async function getUserById(userId: string, requesterId: string, requesterRoles: string[]): Promise<PublicUser | null> {
  const col = getCollection('users');
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(userId);
  } catch {
    return null;
  }
  const doc = await col.findOne({ _id: objectId }) as unknown as UserDoc | null;
  if (!doc || doc.isDeleted) return null;
  const isSelfOrAdmin = userId === requesterId || requesterRoles.includes('administrator');
  return toPublicUser(doc, isSelfOrAdmin);
}

export async function unlockAccount(userId: string): Promise<void> {
  const col = getCollection('users');
  await col.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { lockedUntil: null, failedLoginAttempts: 0, lastFailedLoginAt: null } }
  );
}

export async function assignRole(userId: string, role: string): Promise<void> {
  const validRoles = ['creator', 'moderator', 'administrator'];
  if (!validRoles.includes(role)) throw new ValidationError('Invalid role');

  const col = getCollection('users');
  await col.updateOne(
    { _id: new ObjectId(userId) },
    {
      $addToSet: { roles: role },
      $set: { updatedAt: new Date() },
      $inc: { version: 1 },
    }
  );
}

export async function removeRole(userId: string, role: string): Promise<void> {
  const col = getCollection('users');
  await col.updateOne(
    { _id: new ObjectId(userId) },
    {
      $pull: { roles: role } as any,
      $set: { updatedAt: new Date() },
      $inc: { version: 1 },
    }
  );
}

// Error classes
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
