import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { ValidationError, ConflictError, NotFoundError } from './auth.service';

interface RoomDoc {
  _id: ObjectId;
  zoneId: string;
  name: string;
  description?: string;
  capacity?: number;
  amenities: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export async function createRoom(
  zoneId: string,
  name: string,
  description?: string,
  capacity?: number,
  amenities?: string[]
): Promise<RoomDoc> {
  if (!name || name.trim().length === 0) throw new ValidationError('Room name is required');
  if (!zoneId) throw new ValidationError('Zone ID is required');

  // Verify zone exists
  const zone = await getCollection('zones').findOne({ _id: new ObjectId(zoneId) });
  if (!zone) throw new NotFoundError('Zone not found');

  const col = getCollection('rooms');
  const existing = await col.findOne({ zoneId, name: name.trim() });
  if (existing) throw new ConflictError('Room name already exists in this zone');

  const now = new Date();
  const doc = {
    zoneId,
    name: name.trim(),
    description: description?.trim() || undefined,
    capacity: capacity || undefined,
    amenities: amenities || [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const result = await col.insertOne(doc as any);
  return { ...doc, _id: result.insertedId } as RoomDoc;
}

export async function updateRoom(
  roomId: string,
  updates: {
    name?: string;
    description?: string;
    capacity?: number;
    amenities?: string[];
    isActive?: boolean;
  },
  expectedVersion: number
): Promise<RoomDoc> {
  const col = getCollection('rooms');
  const oid = new ObjectId(roomId);

  const currentRoom = await col.findOne({ _id: oid }) as unknown as RoomDoc | null;
  if (!currentRoom) throw new NotFoundError('Room not found');

  if (updates.name) {
    const existing = await col.findOne({
      zoneId: currentRoom.zoneId,
      name: updates.name.trim(),
      _id: { $ne: oid },
    });
    if (existing) throw new ConflictError('Room name already exists in this zone');
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setFields.name = updates.name.trim();
  if (updates.description !== undefined) setFields.description = updates.description.trim();
  if (updates.capacity !== undefined) setFields.capacity = updates.capacity;
  if (updates.amenities !== undefined) setFields.amenities = updates.amenities;
  if (updates.isActive !== undefined) setFields.isActive = updates.isActive;

  const result = await col.findOneAndUpdate(
    { _id: oid, version: expectedVersion },
    { $set: setFields, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );

  if (!result) {
    throw new ConflictError('Version conflict - room was modified by another request');
  }

  return result as unknown as RoomDoc;
}

export async function getRoomById(roomId: string): Promise<RoomDoc | null> {
  const col = getCollection('rooms');
  try {
    return await col.findOne({ _id: new ObjectId(roomId) }) as unknown as RoomDoc | null;
  } catch {
    return null;
  }
}

export async function listRooms(
  filters: { zoneId?: string; isActive?: boolean; search?: string },
  page: number,
  pageSize: number
): Promise<{ rooms: RoomDoc[]; total: number }> {
  const col = getCollection('rooms');
  const query: Record<string, unknown> = {};
  if (filters.zoneId) query.zoneId = filters.zoneId;
  if (filters.isActive !== undefined) query.isActive = filters.isActive;
  if (filters.search) query.name = { $regex: filters.search, $options: 'i' };

  const total = await col.countDocuments(query);
  const rooms = await col
    .find(query)
    .sort({ zoneId: 1, name: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as RoomDoc[];

  return { rooms, total };
}
