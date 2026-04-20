import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const MIN_KEY_LENGTH = 16;

function getKeyBuffer(hexKey: string): Buffer {
  if (typeof hexKey !== 'string' || hexKey.length === 0) {
    throw new Error('Encryption key must be a non-empty string');
  }
  if (hexKey.length < MIN_KEY_LENGTH) {
    // Warn at startup — callers should ensure a strong key is configured
    console.warn(
      `[crypto] WARNING: Encryption key is shorter than ${MIN_KEY_LENGTH} characters. ` +
      'Use a randomly generated key of at least 32 characters in production.'
    );
  }
  // Derive a fixed 32-byte key via SHA-256 (behaviour unchanged)
  const hash = crypto.createHash('sha256').update(hexKey).digest();
  return hash;
}

export function encryptField(plaintext: string): string {
  const key = getKeyBuffer(config.encryption.fieldKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + encrypted)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptField(encoded: string): string {
  const key = getKeyBuffer(config.encryption.fieldKey);
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function encryptFileBuffer(buffer: Buffer): { encrypted: Buffer; iv: string; tag: string } {
  const key = getKeyBuffer(config.encryption.fileKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decryptFileBuffer(encrypted: Buffer, ivHex: string, tagHex: string): Buffer {
  const key = getKeyBuffer(config.encryption.fileKey);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function hashSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function computeAuditHash(data: string, previousHash?: string): string {
  const input = previousHash ? `${previousHash}:${data}` : data;
  return crypto.createHash('sha256').update(input).digest('hex');
}
