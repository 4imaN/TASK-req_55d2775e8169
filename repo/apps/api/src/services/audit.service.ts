import { ObjectId } from 'mongodb';
import { getAppendOnlyCollection } from '../config/db';
import { computeAuditHash } from '../utils/crypto';

export interface AuditEntry {
  _id?: ObjectId;
  actorUserId: string;
  actorRole: string;
  action: string;
  objectType: string;
  objectId: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  requestId: string;
  previousHash?: string;
  hash: string;
  createdAt: Date;
}

// Get the last audit log hash for chain integrity
async function getLastHash(): Promise<string | undefined> {
  const col = getAppendOnlyCollection('audit_logs');
  const last = await col.findOne({}, { sort: { createdAt: -1 }, projection: { hash: 1 } });
  return last?.hash as string | undefined;
}

// Module-level serialization lock — ensures audit writes are never concurrent
// within a single process, preserving chain integrity.
let auditWriteLock: Promise<void> = Promise.resolve();

export async function writeAuditLog(entry: Omit<AuditEntry, 'hash' | 'previousHash' | 'createdAt' | '_id'>): Promise<void> {
  // Chain each write after the previous one; swallow errors so the lock is always released
  auditWriteLock = auditWriteLock.then(() => _writeAuditLogImpl(entry)).catch(() => {});
  await auditWriteLock;
}

/** Build a canonical, deterministically ordered object for hashing.
 * Field order must match exactly between write and verify paths. */
function buildHashPayload(
  entry: Pick<AuditEntry, 'actorUserId' | 'actorRole' | 'action' | 'objectType' | 'objectId' | 'oldValue' | 'newValue' | 'reason' | 'requestId'>,
  createdAt: string,
  previousHash: string | undefined
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
  };
  if (entry.oldValue !== undefined) payload.oldValue = entry.oldValue;
  if (entry.newValue !== undefined) payload.newValue = entry.newValue;
  if (entry.reason !== undefined) payload.reason = entry.reason;
  payload.requestId = entry.requestId;
  payload.createdAt = createdAt;
  payload.previousHash = previousHash;
  return payload;
}

async function _writeAuditLogImpl(entry: Omit<AuditEntry, 'hash' | 'previousHash' | 'createdAt' | '_id'>): Promise<void> {
  const col = getAppendOnlyCollection('audit_logs');
  const previousHash = await getLastHash();
  const now = new Date();

  // Strip sensitive data from values BEFORE computing the hash so the stored
  // hash always matches the stored (sanitized) values during chain verification.
  const sanitizedEntry = { ...entry };
  if (sanitizedEntry.oldValue) sanitizedEntry.oldValue = sanitizeAuditValue(sanitizedEntry.oldValue);
  if (sanitizedEntry.newValue) sanitizedEntry.newValue = sanitizeAuditValue(sanitizedEntry.newValue);

  // Compute chained hash using the canonical payload builder (same as verify path)
  const payload = buildHashPayload(sanitizedEntry, now.toISOString(), previousHash);
  const dataStr = JSON.stringify(payload);
  const hash = computeAuditHash(dataStr, previousHash);

  const doc: AuditEntry = {
    ...sanitizedEntry,
    previousHash,
    hash,
    createdAt: now,
  };

  await col.insertOne(doc as any);
}

// Never log passwords, tokens, embeddings in audit
const SENSITIVE_FIELDS = ['passwordHash', 'password', 'jwt', 'csrfToken', 'encryptedEmbedding', 'token'];

function sanitizeAuditValue(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export async function verifyAuditChain(): Promise<{ valid: boolean; brokenAt?: string }> {
  const col = getAppendOnlyCollection('audit_logs');
  const cursor = col.find({}).sort({ createdAt: 1 });

  let previousHash: string | undefined;
  for await (const doc of cursor) {
    const entry = doc as unknown as AuditEntry;
    // MongoDB stores undefined as null in BSON. Normalise both sides so that
    // the very first entry (which has no previousHash) compares equal to the
    // loop's initial `undefined` value regardless of whether it was stored as
    // null or left absent in the document.
    const storedPreviousHash = (entry.previousHash ?? undefined) as string | undefined;
    if (storedPreviousHash !== previousHash) {
      return { valid: false, brokenAt: entry._id?.toString() };
    }
    // Use the same canonical payload builder as the write path to reproduce the hash
    const createdAtStr = entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : String(entry.createdAt);
    const payload = buildHashPayload(entry, createdAtStr, storedPreviousHash);
    const dataStr = JSON.stringify(payload);
    const expectedHash = computeAuditHash(dataStr, previousHash);
    if (entry.hash !== expectedHash) {
      return { valid: false, brokenAt: entry._id?.toString() };
    }
    previousHash = entry.hash;
  }

  return { valid: true };
}
