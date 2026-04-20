import { ObjectId, ClientSession } from 'mongodb';
import { DateTime } from 'luxon';
import { getCollection, getClient } from '../config/db';
import { config } from '../config';
import {
  isAlignedTo15Minutes,
  SLOT_INCREMENT_MINUTES,
  DEFAULT_MIN_RESERVATION_MINUTES,
  DEFAULT_MAX_RESERVATION_MINUTES,
  MAX_ALTERNATIVE_SLOTS,
  ALTERNATIVE_SLOT_SEARCH_RANGE_MINUTES,
  DEFAULT_CHECKIN_WINDOW_BEFORE_MINUTES,
  DEFAULT_NOSHOW_GRACE_MINUTES,
  SHARE_LINK_EXPIRY_HOURS_AFTER_END,
} from '@studyroomops/shared-policy';
import { getEffectiveBusinessHours } from './businessHours.service';
import { ValidationError, ConflictError, NotFoundError, ForbiddenError } from './auth.service';
import { generateSecureToken } from '../utils/crypto';
import type { ConflictReason, AlternativeSlot } from '@studyroomops/shared-types';

interface ReservationDoc {
  _id: ObjectId;
  userId: string;
  roomId: string;
  zoneId: string;
  startAtUtc: Date;
  endAtUtc: Date;
  status: string;
  notes?: string;
  canceledBy?: string;
  cancelReason?: string;
  checkedInAt?: Date;
  completedAt?: Date;
  policyVersionId?: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// Generate 15-minute time slices for the reservation interval
function generateSlices(startUtc: Date, endUtc: Date): Date[] {
  const slices: Date[] = [];
  let current = new Date(startUtc);
  while (current < endUtc) {
    slices.push(new Date(current));
    current = new Date(current.getTime() + SLOT_INCREMENT_MINUTES * 60 * 1000);
  }
  return slices;
}

// Check if a time is within business hours for a given room
async function isWithinBusinessHours(
  roomId: string,
  zoneId: string,
  startUtc: Date,
  endUtc: Date
): Promise<boolean> {
  const tz = config.site.timezone;
  const startLocal = DateTime.fromJSDate(startUtc).setZone(tz);
  const endLocal = DateTime.fromJSDate(endUtc).setZone(tz);

  // If reservation spans multiple days, check each day
  let current = startLocal.startOf('day');
  const lastDay = endLocal.startOf('day');

  while (current <= lastDay) {
    const dayOfWeek = current.weekday % 7; // Luxon: 1=Monday, 7=Sunday -> 0=Sunday
    const bh = await getEffectiveBusinessHours(roomId, zoneId, dayOfWeek);
    if (!bh) return false;

    // Check portions within this day
    const dayStart = current;
    const dayEnd = current.plus({ days: 1 });

    const overlapStart = startLocal > dayStart ? startLocal : dayStart;
    const overlapEnd = endLocal < dayEnd ? endLocal : dayEnd;

    if (overlapStart < overlapEnd) {
      const openTime = DateTime.fromISO(`${current.toISODate()}T${bh.openTime}`, { zone: tz });
      const closeTime = DateTime.fromISO(`${current.toISODate()}T${bh.closeTime}`, { zone: tz });

      if (overlapStart < openTime || overlapEnd > closeTime) {
        return false;
      }
    }

    current = current.plus({ days: 1 });
  }

  return true;
}

export async function createReservation(
  userId: string,
  roomId: string,
  startAtUtc: string,
  endAtUtc: string,
  idempotencyKey: string,
  notes?: string
): Promise<{ reservation: ReservationDoc } | { conflict: true; reason: ConflictReason; alternatives: AlternativeSlot[] }> {
  // Check idempotency
  const existingByKey = await getCollection('reservations').findOne({ idempotencyKey, userId }) as unknown as ReservationDoc | null;
  if (existingByKey) {
    return { reservation: existingByKey };
  }

  const start = new Date(startAtUtc);
  const end = new Date(endAtUtc);
  const now = new Date();

  // Validate times are aligned to 15-minute increments
  if (!isAlignedTo15Minutes(start) || !isAlignedTo15Minutes(end)) {
    throw new ValidationError('Reservation times must be aligned to 15-minute increments');
  }

  // Validate end > start
  if (end <= start) {
    throw new ValidationError('End time must be after start time');
  }

  // Validate not in the past
  if (start < now) {
    return {
      conflict: true,
      reason: 'past_time_not_allowed',
      alternatives: await computeAlternatives(roomId, start, end),
    };
  }

  // Validate duration
  const durationMinutes = (end.getTime() - start.getTime()) / (60 * 1000);
  if (durationMinutes < DEFAULT_MIN_RESERVATION_MINUTES || durationMinutes > DEFAULT_MAX_RESERVATION_MINUTES) {
    return {
      conflict: true,
      reason: 'duration_invalid',
      alternatives: [],
    };
  }

  // Check membership tier benefits
  const memberAccount = await getCollection('membership_accounts').findOne({ userId }) as any;
  if (memberAccount?.tierId) {
    const tier = await getCollection('membership_tiers').findOne({ _id: new ObjectId(memberAccount.tierId) }) as any;
    if (tier?.benefits) {
      // Max reservation duration from tier
      if (tier.benefits.maxReservationMinutes && durationMinutes > tier.benefits.maxReservationMinutes) {
        return { conflict: true, reason: 'policy_restriction' as ConflictReason, alternatives: [] };
      }
      // Max concurrent reservations
      if (tier.benefits.maxConcurrentReservations) {
        const activeCount = await getCollection('reservations').countDocuments({
          userId,
          status: { $in: ['confirmed', 'checked_in'] },
        });
        if (activeCount >= tier.benefits.maxConcurrentReservations) {
          return { conflict: true, reason: 'policy_restriction' as ConflictReason, alternatives: [] };
        }
      }
    }
  }

  // Fetch room
  const room = await getCollection('rooms').findOne({ _id: new ObjectId(roomId) }) as any;
  if (!room) throw new NotFoundError('Room not found');
  if (!room.isActive) {
    return {
      conflict: true,
      reason: 'resource_inactive',
      alternatives: await computeAlternatives(roomId, start, end),
    };
  }

  // Check blacklist
  const membership = await getCollection('membership_accounts').findOne({ userId }) as any;
  if (membership?.isBlacklisted) {
    return {
      conflict: true,
      reason: 'blacklisted_user',
      alternatives: [],
    };
  }

  // Check business hours
  const withinHours = await isWithinBusinessHours(roomId, room.zoneId, start, end);
  if (!withinHours) {
    return {
      conflict: true,
      reason: 'outside_business_hours',
      alternatives: await computeAlternatives(roomId, start, end),
    };
  }

  // Generate slices
  const slices = generateSlices(start, end);

  // Attempt transactional insertion
  const client = getClient();
  const session = client.startSession();

  try {
    let reservation: ReservationDoc | null = null;

    await session.withTransaction(async () => {
      const slicesCol = getCollection('reservation_slices');
      const resCol = getCollection('reservations');

      // Insert all slices - unique index will prevent conflicts
      for (const sliceStart of slices) {
        await slicesCol.insertOne(
          {
            resourceId: roomId,
            slotStartUtc: sliceStart,
            reservationId: 'pending', // will update after reservation created
          },
          { session }
        );
      }

      // Create reservation record
      const nowTs = new Date();
      const resDoc: Record<string, unknown> = {
        userId,
        roomId,
        zoneId: room.zoneId,
        startAtUtc: start,
        endAtUtc: end,
        status: 'confirmed',
        idempotencyKey,
        createdAt: nowTs,
        updatedAt: nowTs,
        version: 1,
      };
      if (notes) {
        resDoc.notes = notes;
      }

      const result = await resCol.insertOne(resDoc as any, { session });
      const resId = result.insertedId.toString();

      // Update slices with reservation ID
      await slicesCol.updateMany(
        { resourceId: roomId, reservationId: 'pending' },
        { $set: { reservationId: resId } },
        { session }
      );

      reservation = { ...resDoc, _id: result.insertedId } as unknown as ReservationDoc;
    });

    if (reservation) {
      return { reservation };
    }

    throw new Error('Transaction completed but no reservation created');
  } catch (err: any) {
    // Check for duplicate key error (conflict)
    if (err.code === 11000 || err.message?.includes('duplicate key') || err.codeName === 'DuplicateKey') {
      const alternatives = await computeAlternatives(roomId, start, end);
      return {
        conflict: true,
        reason: 'overlapping_existing_reservation',
        alternatives,
      };
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

async function computeAlternatives(
  requestedRoomId: string,
  requestedStart: Date,
  requestedEnd: Date
): Promise<AlternativeSlot[]> {
  const durationMs = requestedEnd.getTime() - requestedStart.getTime();
  const alternatives: AlternativeSlot[] = [];
  const offsets = [-60, -45, -30, -15, 15, 30, 45, 60]; // minutes

  // Get the room and its zone
  const room = await getCollection('rooms').findOne({ _id: new ObjectId(requestedRoomId) }) as any;
  if (!room) return [];

  // Search same room first
  for (const offset of offsets) {
    if (alternatives.length >= MAX_ALTERNATIVE_SLOTS) break;

    const altStart = new Date(requestedStart.getTime() + offset * 60 * 1000);
    const altEnd = new Date(altStart.getTime() + durationMs);

    // Skip past times
    if (altStart < new Date()) continue;

    // Check business hours
    const withinHours = await isWithinBusinessHours(requestedRoomId, room.zoneId, altStart, altEnd);
    if (!withinHours) continue;

    // Check if slices are available
    const slices = generateSlices(altStart, altEnd);
    const conflicts = await getCollection('reservation_slices').countDocuments({
      resourceId: requestedRoomId,
      slotStartUtc: { $in: slices },
    });

    if (conflicts === 0) {
      alternatives.push({
        roomId: requestedRoomId,
        zoneId: room.zoneId,
        start: altStart.toISOString(),
        end: altEnd.toISOString(),
      });
    }
  }

  // If still need more, search other rooms in same zone
  if (alternatives.length < MAX_ALTERNATIVE_SLOTS) {
    const sameZoneRooms = await getCollection('rooms')
      .find({ zoneId: room.zoneId, isActive: true, _id: { $ne: new ObjectId(requestedRoomId) } })
      .sort({ name: 1 })
      .toArray() as any[];

    for (const otherRoom of sameZoneRooms) {
      if (alternatives.length >= MAX_ALTERNATIVE_SLOTS) break;

      for (const offset of [0, -15, 15, -30, 30, -45, 45, -60, 60]) {
        if (alternatives.length >= MAX_ALTERNATIVE_SLOTS) break;

        const altStart = new Date(requestedStart.getTime() + offset * 60 * 1000);
        const altEnd = new Date(altStart.getTime() + durationMs);

        if (altStart < new Date()) continue;

        const withinHours = await isWithinBusinessHours(otherRoom._id.toString(), otherRoom.zoneId, altStart, altEnd);
        if (!withinHours) continue;

        const slices = generateSlices(altStart, altEnd);
        const conflicts = await getCollection('reservation_slices').countDocuments({
          resourceId: otherRoom._id.toString(),
          slotStartUtc: { $in: slices },
        });

        if (conflicts === 0) {
          alternatives.push({
            roomId: otherRoom._id.toString(),
            zoneId: otherRoom.zoneId,
            start: altStart.toISOString(),
            end: altEnd.toISOString(),
          });
        }
      }
    }
  }

  // Sort by absolute offset from requested start, then same room first, then alphabetical
  alternatives.sort((a, b) => {
    const aOffset = Math.abs(new Date(a.start).getTime() - requestedStart.getTime());
    const bOffset = Math.abs(new Date(b.start).getTime() - requestedStart.getTime());
    if (aOffset !== bOffset) return aOffset - bOffset;
    if (a.roomId === requestedRoomId && b.roomId !== requestedRoomId) return -1;
    if (b.roomId === requestedRoomId && a.roomId !== requestedRoomId) return 1;
    if (a.zoneId === room.zoneId && b.zoneId !== room.zoneId) return -1;
    if (b.zoneId === room.zoneId && a.zoneId !== room.zoneId) return 1;
    return a.start.localeCompare(b.start);
  });

  return alternatives.slice(0, MAX_ALTERNATIVE_SLOTS);
}

export async function cancelReservation(
  reservationId: string,
  userId: string,
  userRoles: string[],
  reason?: string
): Promise<ReservationDoc> {
  const col = getCollection('reservations');
  const res = await col.findOne({ _id: new ObjectId(reservationId) }) as unknown as ReservationDoc | null;
  if (!res) throw new NotFoundError('Reservation not found');

  // Check permission
  const isOwner = res.userId === userId;
  const isStaff = userRoles.includes('creator') || userRoles.includes('administrator');

  if (!isOwner && !isStaff) {
    throw new ForbiddenError('Not authorized to cancel this reservation');
  }

  // Validate transition
  if (res.status === 'confirmed') {
    // Owner can cancel before start
    if (isOwner && !isStaff && new Date() >= res.startAtUtc) {
      throw new ValidationError('Cannot cancel after start time. Contact staff for assistance.');
    }
  } else if (res.status === 'checked_in') {
    // Only admin can cancel after check-in
    if (!userRoles.includes('administrator')) {
      throw new ForbiddenError('Only administrators can cancel checked-in reservations');
    }
  } else {
    throw new ValidationError(`Cannot cancel reservation in ${res.status} status`);
  }

  if (isStaff && !reason) {
    throw new ValidationError('Staff cancellations require a reason');
  }

  const now = new Date();

  // Wrap slice deletion and reservation update in a transaction so that
  // a version-conflict on the reservation does not leave slices deleted
  // while the reservation remains active (which would allow double-booking).
  const client = getClient();
  const session = client.startSession();

  try {
    let updated: ReservationDoc | null = null;

    await session.withTransaction(async () => {
      // Update reservation first — if version guard fails the transaction aborts
      // and no slices are deleted.
      const result = await col.findOneAndUpdate(
        { _id: new ObjectId(reservationId), version: res.version },
        {
          $set: {
            status: 'canceled',
            canceledBy: userId,
            cancelReason: reason || 'User canceled',
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', session }
      );

      if (!result) {
        throw new ConflictError('Version conflict');
      }

      // Release future slices within the same transaction
      await getCollection('reservation_slices').deleteMany(
        {
          reservationId: reservationId,
          slotStartUtc: { $gte: now },
        },
        { session }
      );

      updated = result as unknown as ReservationDoc;
    });

    if (!updated) throw new ConflictError('Version conflict');
    return updated;
  } finally {
    await session.endSession();
  }
}

export async function checkIn(
  reservationId: string,
  performedBy: string,
  source: 'manual' | 'staff' | 'vision'
): Promise<ReservationDoc> {
  const col = getCollection('reservations');
  const res = await col.findOne({ _id: new ObjectId(reservationId) }) as unknown as ReservationDoc | null;
  if (!res) throw new NotFoundError('Reservation not found');

  if (res.status !== 'confirmed') {
    throw new ValidationError(`Cannot check in reservation in ${res.status} status`);
  }

  // Check if within check-in window
  const now = new Date();
  const windowStart = new Date(res.startAtUtc.getTime() - DEFAULT_CHECKIN_WINDOW_BEFORE_MINUTES * 60 * 1000);

  if (now < windowStart) {
    throw new ValidationError('Check-in window has not opened yet');
  }

  if (now > res.endAtUtc) {
    throw new ValidationError('Cannot check in after reservation end time');
  }

  const updated = await col.findOneAndUpdate(
    { _id: new ObjectId(reservationId), version: res.version },
    {
      $set: {
        status: 'checked_in',
        checkedInAt: now,
        updatedAt: now,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) throw new ConflictError('Version conflict');

  // Record check-in event
  await getCollection('check_in_events').insertOne({
    reservationId,
    userId: res.userId,
    source,
    performedBy,
    createdAt: now,
  } as any);

  return updated as unknown as ReservationDoc;
}

export async function getReservation(reservationId: string): Promise<ReservationDoc | null> {
  try {
    return await getCollection('reservations').findOne({ _id: new ObjectId(reservationId) }) as unknown as ReservationDoc | null;
  } catch {
    return null;
  }
}

export async function listUserReservations(
  userId: string,
  filters: { status?: string; startDate?: string; endDate?: string },
  page: number,
  pageSize: number
): Promise<{ reservations: ReservationDoc[]; total: number }> {
  const col = getCollection('reservations');
  const query: Record<string, unknown> = { userId };
  if (filters.status) query.status = filters.status;
  if (filters.startDate || filters.endDate) {
    query.startAtUtc = {};
    if (filters.startDate) (query.startAtUtc as any).$gte = new Date(filters.startDate);
    if (filters.endDate) (query.startAtUtc as any).$lte = new Date(filters.endDate);
  }

  const total = await col.countDocuments(query);
  const reservations = await col
    .find(query)
    .sort({ startAtUtc: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as ReservationDoc[];

  return { reservations, total };
}

export async function listAllReservations(
  filters: { userId?: string; roomId?: string; zoneId?: string; status?: string; startDate?: string; endDate?: string },
  page: number,
  pageSize: number
): Promise<{ reservations: ReservationDoc[]; total: number }> {
  const col = getCollection('reservations');
  const query: Record<string, unknown> = {};
  if (filters.userId) query.userId = filters.userId;
  if (filters.roomId) query.roomId = filters.roomId;
  if (filters.zoneId) query.zoneId = filters.zoneId;
  if (filters.status) query.status = filters.status;
  if (filters.startDate || filters.endDate) {
    query.startAtUtc = {};
    if (filters.startDate) (query.startAtUtc as any).$gte = new Date(filters.startDate);
    if (filters.endDate) (query.startAtUtc as any).$lte = new Date(filters.endDate);
  }

  const total = await col.countDocuments(query);
  const reservations = await col
    .find(query)
    .sort({ startAtUtc: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as ReservationDoc[];

  return { reservations, total };
}

// Get availability for a room over a date range
export async function getAvailability(
  roomId: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; slots: { start: string; end: string; available: boolean }[] }[]> {
  const tz = config.site.timezone;
  const room = await getCollection('rooms').findOne({ _id: new ObjectId(roomId) }) as any;
  if (!room) throw new NotFoundError('Room not found');

  const result: { date: string; slots: { start: string; end: string; available: boolean }[] }[] = [];

  let current = DateTime.fromISO(startDate, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(endDate, { zone: tz }).endOf('day');

  while (current <= end) {
    const dayOfWeek = current.weekday % 7;
    const bh = await getEffectiveBusinessHours(roomId, room.zoneId, dayOfWeek);

    const daySlots: { start: string; end: string; available: boolean }[] = [];

    if (bh) {
      const openTime = DateTime.fromISO(`${current.toISODate()}T${bh.openTime}`, { zone: tz });
      const closeTime = DateTime.fromISO(`${current.toISODate()}T${bh.closeTime}`, { zone: tz });

      let slotStart = openTime;
      while (slotStart < closeTime) {
        const slotEnd = slotStart.plus({ minutes: SLOT_INCREMENT_MINUTES });
        const slotStartUtc = slotStart.toUTC().toJSDate();

        // Check if this slice is occupied
        const occupied = await getCollection('reservation_slices').findOne({
          resourceId: roomId,
          slotStartUtc: slotStartUtc,
        });

        daySlots.push({
          start: slotStart.toISO()!,
          end: slotEnd.toISO()!,
          available: !occupied,
        });

        slotStart = slotEnd;
      }
    }

    result.push({
      date: current.toISODate()!,
      slots: daySlots,
    });

    current = current.plus({ days: 1 });
  }

  return result;
}

// Favorites
export async function addFavorite(userId: string, roomId: string): Promise<void> {
  const room = await getCollection('rooms').findOne({ _id: new ObjectId(roomId) });
  if (!room) throw new NotFoundError('Room not found');

  try {
    await getCollection('favorite_rooms').insertOne({
      userId,
      roomId,
      createdAt: new Date(),
    } as any);
  } catch (err: any) {
    if (err.code === 11000) return; // Already favorited
    throw err;
  }
}

export async function removeFavorite(userId: string, roomId: string): Promise<void> {
  await getCollection('favorite_rooms').deleteOne({ userId, roomId });
}

export async function listFavorites(userId: string): Promise<any[]> {
  const favorites = await getCollection('favorite_rooms')
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  // Fetch room details
  const roomIds = favorites.map((f: any) => new ObjectId(f.roomId));
  const rooms = await getCollection('rooms')
    .find({ _id: { $in: roomIds } })
    .toArray();

  const roomMap = new Map(rooms.map((r: any) => [r._id.toString(), r]));

  return favorites.map((f: any) => ({
    ...f,
    room: roomMap.get(f.roomId) || null,
  }));
}

// Share links
export async function createShareLink(userId: string, reservationId: string): Promise<{ token: string; expiresAt: Date }> {
  const res = await getCollection('reservations').findOne({ _id: new ObjectId(reservationId) }) as unknown as ReservationDoc | null;
  if (!res) throw new NotFoundError('Reservation not found');
  if (res.userId !== userId) throw new ForbiddenError('Can only share your own reservations');

  const token = generateSecureToken();
  const expiresAt = new Date(res.endAtUtc.getTime() + SHARE_LINK_EXPIRY_HOURS_AFTER_END * 3600 * 1000);

  await getCollection('reservation_share_links').insertOne({
    reservationId,
    createdByUserId: userId,
    token,
    expiresAt,
    revokedAt: null,
    createdAt: new Date(),
  } as any);

  return { token, expiresAt };
}

export async function getSharedReservation(token: string): Promise<any | null> {
  const link = await getCollection('reservation_share_links').findOne({
    token,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }) as any;

  if (!link) return null;

  const res = await getCollection('reservations').findOne({ _id: new ObjectId(link.reservationId) }) as any;
  if (!res) return null;

  const room = await getCollection('rooms').findOne({ _id: new ObjectId(res.roomId) }) as any;
  const zone = room ? await getCollection('zones').findOne({ _id: new ObjectId(room.zoneId) }) : null;

  return {
    roomName: room?.name,
    zoneName: zone?.name,
    startAtUtc: res.startAtUtc,
    endAtUtc: res.endAtUtc,
    status: res.status,
  };
}

export async function revokeShareLink(userId: string, token: string): Promise<void> {
  await getCollection('reservation_share_links').updateOne(
    { token, createdByUserId: userId },
    { $set: { revokedAt: new Date() } }
  );
}
