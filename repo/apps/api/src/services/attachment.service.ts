import { ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { getCollection } from '../config/db';
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  MAGIC_BYTES,
} from '@studyroomops/shared-policy';
import { hashSha256, encryptFileBuffer, decryptFileBuffer } from '../utils/crypto';
import { ValidationError, NotFoundError, ForbiddenError } from './auth.service';
import { hasRole, isAdmin } from '../middleware/auth';

// ── Constants ──────────────────────────────────────────────────────────────

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');

// ── Types ──────────────────────────────────────────────────────────────────

export interface AttachmentDoc {
  _id: ObjectId;
  parentType: string;
  parentId: string;
  uploadedByUserId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  storagePath: string;
  encryptionIv: string;
  encryptionTag: string;
  createdAt: Date;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function checkMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;

  return signatures.some((sig) =>
    sig.every((byte, i) => buffer[i] === byte)
  );
}

function toPublicAttachment(doc: AttachmentDoc): Record<string, unknown> {
  return {
    _id: doc._id.toString(),
    parentType: doc.parentType,
    parentId: doc.parentId,
    uploadedByUserId: doc.uploadedByUserId,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    sha256Hash: doc.sha256Hash,
    createdAt: doc.createdAt,
  };
}

async function resolveParentOwner(parentType: string, parentId: string): Promise<string | null> {
  if (parentType === 'lead') {
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(parentId);
    } catch {
      return null;
    }
    const lead = await getCollection('leads').findOne({ _id: objectId }) as any;
    return lead?.requesterUserId ?? null;
  }
  return null;
}

// ── Service Functions ──────────────────────────────────────────────────────

export async function uploadAttachment(
  parentType: string,
  parentId: string,
  userId: string,
  userRoles: string[],
  file: UploadedFile
): Promise<Record<string, unknown>> {
  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);

  // Verify access: must be owner or staff
  const ownerUserId = await resolveParentOwner(parentType, parentId);
  if (ownerUserId === null) {
    throw new NotFoundError(`Parent ${parentType} not found`);
  }
  if (!isStaff && ownerUserId !== userId) {
    throw new ForbiddenError('You do not have access to upload attachments to this resource');
  }

  // Validate MIME type against allowed list
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new ValidationError(
      `Unsupported file type '${file.mimetype}'. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
    );
  }

  // Validate magic bytes
  if (!checkMagicBytes(file.buffer, file.mimetype)) {
    throw new ValidationError(
      'File content does not match declared MIME type (magic bytes mismatch)'
    );
  }

  // Compute SHA-256 hash for deduplication
  const sha256Hash = hashSha256(file.buffer);

  // Check for existing blob by hash (deduplication)
  const attachmentsCol = getCollection('attachments');
  const existingBlob = await attachmentsCol.findOne({ sha256Hash }) as unknown as AttachmentDoc | null;

  let storagePath: string;
  let encryptionIv: string;
  let encryptionTag: string;

  if (existingBlob) {
    // Reuse existing blob storage
    storagePath = existingBlob.storagePath;
    encryptionIv = existingBlob.encryptionIv;
    encryptionTag = existingBlob.encryptionTag;
  } else {
    // Encrypt and write to disk
    ensureUploadDir();
    const { encrypted, iv, tag } = encryptFileBuffer(file.buffer);
    const fileName = `${sha256Hash}.enc`;
    storagePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(storagePath, encrypted);
    encryptionIv = iv;
    encryptionTag = tag;
  }

  // Create attachment metadata
  const now = new Date();
  const doc: Omit<AttachmentDoc, '_id'> = {
    parentType,
    parentId,
    uploadedByUserId: userId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    sha256Hash,
    storagePath,
    encryptionIv,
    encryptionTag,
    createdAt: now,
  };

  const result = await attachmentsCol.insertOne(doc as any);
  return toPublicAttachment({ ...doc, _id: result.insertedId } as AttachmentDoc);
}

export async function getAttachmentById(
  attachmentId: string,
  userId: string,
  userRoles: string[]
): Promise<{ meta: Record<string, unknown>; buffer: Buffer }> {
  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(attachmentId);
  } catch {
    throw new NotFoundError('Attachment not found');
  }

  const attachment = await getCollection('attachments').findOne({ _id: objectId }) as unknown as AttachmentDoc | null;
  if (!attachment) throw new NotFoundError('Attachment not found');

  // Scope access to owner or staff
  const ownerUserId = await resolveParentOwner(attachment.parentType, attachment.parentId);
  if (!isStaff && ownerUserId !== userId) {
    throw new ForbiddenError('You do not have access to this attachment');
  }

  // Read and decrypt
  if (!fs.existsSync(attachment.storagePath)) {
    throw new NotFoundError('Attachment file not found on disk');
  }

  const encryptedBuffer = fs.readFileSync(attachment.storagePath);
  const buffer = decryptFileBuffer(encryptedBuffer, attachment.encryptionIv, attachment.encryptionTag);

  return { meta: toPublicAttachment(attachment), buffer };
}

export async function listAttachments(
  parentType: string,
  parentId: string,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>[]> {
  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);

  // Verify access
  const ownerUserId = await resolveParentOwner(parentType, parentId);
  if (ownerUserId === null) {
    throw new NotFoundError(`Parent ${parentType} not found`);
  }
  if (!isStaff && ownerUserId !== userId) {
    throw new ForbiddenError('You do not have access to this resource');
  }

  const docs = await getCollection('attachments')
    .find({ parentType, parentId })
    .sort({ createdAt: -1 })
    .toArray() as unknown as AttachmentDoc[];

  return docs.map(toPublicAttachment);
}

export async function deleteAttachment(
  attachmentId: string,
  userId: string,
  userRoles: string[]
): Promise<void> {
  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(attachmentId);
  } catch {
    throw new NotFoundError('Attachment not found');
  }

  const attachment = await getCollection('attachments').findOne({ _id: objectId }) as unknown as AttachmentDoc | null;
  if (!attachment) throw new NotFoundError('Attachment not found');

  // Scope access to owner or staff
  const ownerUserId = await resolveParentOwner(attachment.parentType, attachment.parentId);
  if (!isStaff && ownerUserId !== userId) {
    throw new ForbiddenError('You do not have access to delete this attachment');
  }

  await getCollection('attachments').deleteOne({ _id: objectId });

  // Only delete the blob file if no other attachment references it
  const remaining = await getCollection('attachments').countDocuments({ sha256Hash: attachment.sha256Hash });
  if (remaining === 0 && fs.existsSync(attachment.storagePath)) {
    fs.unlinkSync(attachment.storagePath);
  }
}
