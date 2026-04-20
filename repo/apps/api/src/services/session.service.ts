import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { getCollection } from '../config/db';
import { config } from '../config';
import {
  SESSION_IDLE_EXPIRY_MINUTES,
  SESSION_ABSOLUTE_EXPIRY_HOURS,
  SESSION_REFRESH_THROTTLE_SECONDS,
} from '@studyroomops/shared-policy';

interface SessionDoc {
  _id: ObjectId;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  status: 'active' | 'expired_idle' | 'expired_absolute' | 'revoked';
}

export interface JwtPayload {
  sessionId: string;
  userId: string;
}

export async function createSession(userId: string): Promise<{ token: string; sessionId: string }> {
  const col = getCollection('sessions');
  const now = new Date();
  const idleMinutes = config.jwt.idleExpiryMinutes || SESSION_IDLE_EXPIRY_MINUTES;
  const absoluteHours = config.jwt.absoluteExpiryHours || SESSION_ABSOLUTE_EXPIRY_HOURS;

  const expiresAt = new Date(now.getTime() + idleMinutes * 60 * 1000);
  const absoluteExpiresAt = new Date(now.getTime() + absoluteHours * 3600 * 1000);

  const sessionDoc: Omit<SessionDoc, '_id'> = {
    userId,
    createdAt: now,
    lastActivityAt: now,
    expiresAt,
    absoluteExpiresAt,
    revokedAt: null,
    status: 'active',
  };

  const result = await col.insertOne(sessionDoc as any);
  const sessionId = result.insertedId.toString();

  const token = jwt.sign(
    { sessionId, userId } as JwtPayload,
    config.jwt.secret,
    { expiresIn: `${absoluteHours}h` }
  );

  return { token, sessionId };
}

export async function validateSession(token: string): Promise<{ userId: string; sessionId: string; roles: string[] } | null> {
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
  } catch {
    return null;
  }

  const col = getCollection('sessions');
  const session = await col.findOne({ _id: new ObjectId(decoded.sessionId) }) as unknown as SessionDoc | null;
  if (!session) return null;

  const now = new Date();

  // Check revoked
  if (session.status === 'revoked' || session.revokedAt) return null;

  // Check absolute expiry
  if (now > session.absoluteExpiresAt) {
    await col.updateOne(
      { _id: session._id },
      { $set: { status: 'expired_absolute', updatedAt: now } }
    );
    return null;
  }

  // Check idle expiry
  if (now > session.expiresAt) {
    await col.updateOne(
      { _id: session._id },
      { $set: { status: 'expired_idle', updatedAt: now } }
    );
    return null;
  }

  // Refresh idle timer (throttled to once per minute)
  const timeSinceLastActivity = now.getTime() - session.lastActivityAt.getTime();
  if (timeSinceLastActivity > SESSION_REFRESH_THROTTLE_SECONDS * 1000) {
    const idleMinutes = config.jwt.idleExpiryMinutes || SESSION_IDLE_EXPIRY_MINUTES;
    const newExpiresAt = new Date(now.getTime() + idleMinutes * 60 * 1000);
    await col.updateOne(
      { _id: session._id },
      { $set: { lastActivityAt: now, expiresAt: newExpiresAt } }
    );
  }

  // Fetch user roles
  const userDoc = await getCollection('users').findOne(
    { _id: new ObjectId(session.userId) },
    { projection: { roles: 1, isActive: 1, isDeleted: 1 } }
  ) as any;

  if (!userDoc || userDoc.isDeleted || !userDoc.isActive) return null;

  return {
    userId: session.userId,
    sessionId: decoded.sessionId,
    roles: userDoc.roles || [],
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const col = getCollection('sessions');
  const now = new Date();
  await col.updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { status: 'revoked', revokedAt: now, updatedAt: now } }
  );
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const col = getCollection('sessions');
  const now = new Date();
  await col.updateMany(
    { userId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: now, updatedAt: now } }
  );
}
