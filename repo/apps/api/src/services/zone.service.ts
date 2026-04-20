import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { ValidationError, ConflictError, NotFoundError } from './auth.service';

interface ZoneDoc {
  _id: ObjectId;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export async function createZone(name: string, description?: string): Promise<ZoneDoc> {
  if (!name || name.trim().length === 0) throw new ValidationError('Zone name is required');

  const col = getCollection('zones');
  const existing = await col.findOne({ name: name.trim() });
  if (existing) throw new ConflictError('Zone name already exists');

  const now = new Date();
  const doc = {
    name: name.trim(),
    description: description?.trim() || undefined,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await col.insertOne(doc as any);
  return { ...doc, _id: result.insertedId } as ZoneDoc;
}

export async function updateZone(
  zoneId: string,
  updates: { name?: string; description?: string; isActive?: boolean },
  expectedVersion: number
): Promise<ZoneDoc> {
  const col = getCollection('zones');
  const oid = new ObjectId(zoneId);

  if (updates.name) {
    const existing = await col.findOne({ name: updates.name.trim(), _id: { $ne: oid } });
    if (existing) throw new ConflictError('Zone name already exists');
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setFields.name = updates.name.trim();
  if (updates.description !== undefined) setFields.description = updates.description.trim();
  if (updates.isActive !== undefined) setFields.isActive = updates.isActive;

  const result = await col.findOneAndUpdate(
    { _id: oid, version: expectedVersion },
    { $set: setFields, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );

  if (!result) {
    const exists = await col.findOne({ _id: oid });
    if (!exists) throw new NotFoundError('Zone not found');
    throw new ConflictError('Version conflict - zone was modified by another request');
  }

  return result as unknown as ZoneDoc;
}

export async function getZoneById(zoneId: string): Promise<ZoneDoc | null> {
  const col = getCollection('zones');
  try {
    return await col.findOne({ _id: new ObjectId(zoneId) }) as unknown as ZoneDoc | null;
  } catch {
    return null;
  }
}

export async function listZones(
  filters: { isActive?: boolean },
  page: number,
  pageSize: number
): Promise<{ zones: ZoneDoc[]; total: number }> {
  const col = getCollection('zones');
  const query: Record<string, unknown> = {};
  if (filters.isActive !== undefined) query.isActive = filters.isActive;

  const total = await col.countDocuments(query);
  const zones = await col
    .find(query)
    .sort({ name: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as ZoneDoc[];

  return { zones, total };
}
