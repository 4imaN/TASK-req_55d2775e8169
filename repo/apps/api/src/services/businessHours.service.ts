import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { ValidationError, NotFoundError } from './auth.service';
import { DEFAULT_BUSINESS_HOURS_START, DEFAULT_BUSINESS_HOURS_END } from '@studyroomops/shared-policy';

interface BusinessHoursDoc {
  _id: ObjectId;
  scope: 'site' | 'zone' | 'room';
  scopeId: string | null;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

function validateTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

export async function setBusinessHours(
  scope: 'site' | 'zone' | 'room',
  scopeId: string | null,
  dayOfWeek: number,
  openTime: string,
  closeTime: string
): Promise<BusinessHoursDoc> {
  if (dayOfWeek < 0 || dayOfWeek > 6) {
    throw new ValidationError('Day of week must be 0 (Sunday) through 6 (Saturday)');
  }
  if (!validateTimeFormat(openTime)) throw new ValidationError('Invalid open time format (HH:mm)');
  if (!validateTimeFormat(closeTime)) throw new ValidationError('Invalid close time format (HH:mm)');
  if (openTime >= closeTime) throw new ValidationError('Open time must be before close time');

  if (scope !== 'site' && !scopeId) {
    throw new ValidationError('Scope ID required for zone/room business hours');
  }

  const col = getCollection('business_hours');
  const now = new Date();

  // Upsert: replace existing for same scope/scopeId/day
  const filter: Record<string, unknown> = { scope, dayOfWeek };
  if (scopeId) {
    filter.scopeId = scopeId;
  } else {
    filter.scopeId = null;
  }

  // Check if the document already exists to determine whether to insert or update
  const existing = await col.findOne(filter) as unknown as BusinessHoursDoc | null;

  let result: BusinessHoursDoc | null;
  if (existing) {
    result = await col.findOneAndUpdate(
      filter,
      {
        $set: {
          openTime,
          closeTime,
          isActive: true,
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' }
    ) as unknown as BusinessHoursDoc | null;
  } else {
    const doc = {
      scope,
      scopeId: scopeId || null,
      dayOfWeek,
      openTime,
      closeTime,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const insertResult = await col.insertOne(doc as any);
    result = await col.findOne({ _id: insertResult.insertedId }) as unknown as BusinessHoursDoc | null;
  }

  return result as unknown as BusinessHoursDoc;
}

export async function getBusinessHours(
  scope: 'site' | 'zone' | 'room',
  scopeId?: string
): Promise<BusinessHoursDoc[]> {
  const col = getCollection('business_hours');
  const query: Record<string, unknown> = { scope, isActive: true };
  if (scopeId) {
    query.scopeId = scopeId;
  } else {
    query.scopeId = null;
  }

  return await col
    .find(query)
    .sort({ dayOfWeek: 1 })
    .toArray() as unknown as BusinessHoursDoc[];
}

// Get effective business hours for a room, applying override precedence
export async function getEffectiveBusinessHours(
  roomId: string,
  zoneId: string,
  dayOfWeek: number
): Promise<{ openTime: string; closeTime: string } | null> {
  const col = getCollection('business_hours');

  // Priority 1: Room override
  const roomHours = await col.findOne({
    scope: 'room',
    scopeId: roomId,
    dayOfWeek,
    isActive: true,
  }) as unknown as BusinessHoursDoc | null;
  if (roomHours) return { openTime: roomHours.openTime, closeTime: roomHours.closeTime };

  // Priority 2: Zone override
  const zoneHours = await col.findOne({
    scope: 'zone',
    scopeId: zoneId,
    dayOfWeek,
    isActive: true,
  }) as unknown as BusinessHoursDoc | null;
  if (zoneHours) return { openTime: zoneHours.openTime, closeTime: zoneHours.closeTime };

  // Priority 3: Site default
  const siteHours = await col.findOne({
    scope: 'site',
    scopeId: null,
    dayOfWeek,
    isActive: true,
  }) as unknown as BusinessHoursDoc | null;
  if (siteHours) return { openTime: siteHours.openTime, closeTime: siteHours.closeTime };

  return null;
}

export async function deleteBusinessHours(id: string): Promise<void> {
  const col = getCollection('business_hours');
  const result = await col.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new NotFoundError('Business hours entry not found');
}

// Seed default site business hours for all days
export async function seedDefaultBusinessHours(): Promise<void> {
  const col = getCollection('business_hours');
  const existing = await col.countDocuments({ scope: 'site' });
  if (existing > 0) return; // Already seeded

  const now = new Date();
  const docs = [];
  for (let day = 0; day <= 6; day++) {
    docs.push({
      scope: 'site',
      scopeId: null,
      dayOfWeek: day,
      openTime: DEFAULT_BUSINESS_HOURS_START,
      closeTime: DEFAULT_BUSINESS_HOURS_END,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }
  await col.insertMany(docs as any);
}
