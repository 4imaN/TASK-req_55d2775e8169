import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { ValidationError, NotFoundError } from './auth.service';
import { DateTime } from 'luxon';
import { config } from '../config';
import { DEFAULT_BUSINESS_HOURS_START, DEFAULT_BUSINESS_HOURS_END } from '@studyroomops/shared-policy';

export type KpiName =
  | 'booking_conversion'
  | 'attendance_rate'
  | 'noshow_rate'
  | 'peak_utilization'
  | 'offpeak_utilization';

export type Grain = 'day' | 'week' | 'month';

export interface AnalyticsSnapshotDoc {
  _id: ObjectId;
  kpiName: string;
  grain: Grain;
  periodStart: Date;
  periodEnd: Date;
  roomId?: string;
  zoneId?: string;
  policyVersionId?: string;
  value: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface KpiFilters {
  grain: Grain;
  roomId?: string;
  zoneId?: string;
  startDate: Date;
  endDate: Date;
}

// ── Build reservation query from filters ──────────────────────────────────────
function buildResQuery(filters: KpiFilters, extraFields?: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {
    startAtUtc: { $gte: filters.startDate, $lte: filters.endDate },
    ...extraFields,
  };
  if (filters.roomId) query.roomId = filters.roomId;
  if (filters.zoneId) {
    // join via room
    query.zoneId = filters.zoneId;
  }
  return query;
}

// ── Attempt counter helpers ───────────────────────────────────────────────────

async function getAttemptCount(startDate: Date, endDate: Date, roomId?: string, zoneId?: string): Promise<number> {
  const col = getCollection('reservation_attempts');
  const query: Record<string, unknown> = {
    attemptedAt: { $gte: startDate, $lte: endDate },
  };
  if (roomId) {
    query.roomId = roomId;
  } else if (zoneId) {
    const roomsInZone = await getCollection('rooms').find({ zoneId } as any).project({ _id: 1 }).toArray();
    query.roomId = { $in: roomsInZone.map((r: any) => r._id.toString()) };
  }
  return col.countDocuments(query as any);
}

async function getSuccessfulAttemptCount(startDate: Date, endDate: Date, roomId?: string, zoneId?: string): Promise<number> {
  const col = getCollection('reservation_attempts');
  const query: Record<string, unknown> = {
    attemptedAt: { $gte: startDate, $lte: endDate },
    successful: true,
  };
  if (roomId) {
    query.roomId = roomId;
  } else if (zoneId) {
    const roomsInZone = await getCollection('rooms').find({ zoneId } as any).project({ _id: 1 }).toArray();
    query.roomId = { $in: roomsInZone.map((r: any) => r._id.toString()) };
  }
  return col.countDocuments(query as any);
}

// ── computeBookingConversion ───────────────────────────────────────────────────
// successful_reservation_attempts / total_reservation_attempts
export async function computeBookingConversion(filters: KpiFilters): Promise<number> {
  const [attempts, successful] = await Promise.all([
    getAttemptCount(filters.startDate, filters.endDate, filters.roomId, filters.zoneId),
    getSuccessfulAttemptCount(filters.startDate, filters.endDate, filters.roomId, filters.zoneId),
  ]);
  if (attempts === 0) return 0;
  return parseFloat((successful / attempts).toFixed(4));
}

// ── computeAttendanceRate ─────────────────────────────────────────────────────
// checked_in_or_completed / eligible_started (excludes canceled before start)
export async function computeAttendanceRate(filters: KpiFilters): Promise<number> {
  const resCol = getCollection('reservations');
  const baseQuery = buildResQuery(filters);

  const eligibleQuery = {
    ...baseQuery,
    status: { $nin: ['canceled'] },
  };
  const eligible = await resCol.countDocuments(eligibleQuery as any);

  const attendedQuery = {
    ...baseQuery,
    status: { $in: ['checked_in', 'completed'] },
  };
  const attended = await resCol.countDocuments(attendedQuery as any);

  if (eligible === 0) return 0;
  return parseFloat((attended / eligible).toFixed(4));
}

// ── computeNoshowRate ─────────────────────────────────────────────────────────
// expired_no_show / eligible_started
export async function computeNoshowRate(filters: KpiFilters): Promise<number> {
  const resCol = getCollection('reservations');
  const baseQuery = buildResQuery(filters);

  const eligibleQuery = {
    ...baseQuery,
    status: { $nin: ['canceled'] },
  };
  const eligible = await resCol.countDocuments(eligibleQuery as any);

  const noshowQuery = {
    ...baseQuery,
    status: 'expired_no_show',
  };
  const noshows = await resCol.countDocuments(noshowQuery as any);

  if (eligible === 0) return 0;
  return parseFloat((noshows / eligible).toFixed(4));
}

// ── Business hours helper ────────────────────────────────────────────────────
async function getBusinessHoursRange(): Promise<{ openHour: number; closeHour: number }> {
  // Use site-level business hours if available; fall back to shared-policy defaults
  const bhCol = getCollection('business_hours');
  const siteHours = await bhCol
    .find({ scope: 'site', isActive: true } as any)
    .sort({ dayOfWeek: 1 })
    .limit(1)
    .toArray() as any[];

  if (siteHours.length > 0) {
    const openHour = parseInt(siteHours[0].openTime.split(':')[0], 10);
    const closeHour = parseInt(siteHours[0].closeTime.split(':')[0], 10);
    return { openHour, closeHour };
  }

  return {
    openHour: parseInt(DEFAULT_BUSINESS_HOURS_START.split(':')[0], 10),
    closeHour: parseInt(DEFAULT_BUSINESS_HOURS_END.split(':')[0], 10),
  };
}

// ── Peak/OffPeak helpers ──────────────────────────────────────────────────────
async function getPeakHours(): Promise<{ peakStart: number; peakEnd: number }> {
  const pvCol = getCollection('policy_versions');
  const policy = await pvCol.findOne(
    { policyArea: 'analytics' } as any,
    { sort: { effectiveAt: -1 } }
  ) as any;

  const startTime = policy?.settings?.peakStartTime;
  const endTime = policy?.settings?.peakEndTime;

  return {
    peakStart: startTime ? parseInt(startTime.split(':')[0], 10) : 9,
    peakEnd: endTime ? parseInt(endTime.split(':')[0], 10) : 17,
  };
}

// Minutes of the reservation that fall in the peak window
function peakMinutesInWindow(
  startAt: Date,
  endAt: Date,
  peakStart: number,
  peakEnd: number,
  tz: string
): number {
  const s = DateTime.fromJSDate(startAt).setZone(tz);
  const e = DateTime.fromJSDate(endAt).setZone(tz);
  const dayStart = s.startOf('day');

  const windowStart = dayStart.plus({ hours: peakStart });
  const windowEnd = dayStart.plus({ hours: peakEnd });

  const overlapStart = s > windowStart ? s : windowStart;
  const overlapEnd = e < windowEnd ? e : windowEnd;

  if (overlapEnd <= overlapStart) return 0;
  return overlapEnd.diff(overlapStart, 'minutes').minutes;
}

// ── computePeakUtilization ────────────────────────────────────────────────────
export async function computePeakUtilization(filters: KpiFilters): Promise<number> {
  const { peakStart, peakEnd } = await getPeakHours();
  const { openHour, closeHour } = await getBusinessHoursRange();
  // Only count peak hours that fall within business hours
  const peakHoursPerDay = Math.max(0, Math.min(peakEnd, closeHour) - Math.max(peakStart, openHour));

  const resCol = getCollection('reservations');
  const roomCol = getCollection('rooms');

  // Count active rooms (optionally filtered)
  const roomQuery: Record<string, unknown> = { isActive: true };
  if (filters.roomId) roomQuery._id = new ObjectId(filters.roomId);
  if (filters.zoneId) roomQuery.zoneId = filters.zoneId;
  const roomCount = await roomCol.countDocuments(roomQuery as any);

  const days = Math.ceil(
    (filters.endDate.getTime() - filters.startDate.getTime()) / (24 * 3600 * 1000)
  ) + 1;

  const availableMinutes = roomCount * peakHoursPerDay * 60 * days;
  if (availableMinutes === 0) return 0;

  const resQuery = buildResQuery(filters, {
    status: { $in: ['confirmed', 'checked_in', 'completed'] },
  });
  const reservations = await resCol.find(resQuery as any).toArray() as any[];

  let bookedPeakMinutes = 0;
  for (const res of reservations) {
    bookedPeakMinutes += peakMinutesInWindow(
      res.startAtUtc,
      res.endAtUtc,
      peakStart,
      peakEnd,
      config.site.timezone
    );
  }

  return parseFloat((bookedPeakMinutes / availableMinutes).toFixed(4));
}

// ── computeOffPeakUtilization ─────────────────────────────────────────────────
export async function computeOffPeakUtilization(filters: KpiFilters): Promise<number> {
  const { peakStart, peakEnd } = await getPeakHours();
  const { openHour, closeHour } = await getBusinessHoursRange();
  // Off-peak = business hours minus peak hours within business hours
  const businessHoursPerDay = closeHour - openHour;
  const peakWithinBusiness = Math.max(0, Math.min(peakEnd, closeHour) - Math.max(peakStart, openHour));
  const offPeakHoursPerDay = businessHoursPerDay - peakWithinBusiness;

  const resCol = getCollection('reservations');
  const roomCol = getCollection('rooms');

  const roomQuery: Record<string, unknown> = { isActive: true };
  if (filters.roomId) roomQuery._id = new ObjectId(filters.roomId);
  if (filters.zoneId) roomQuery.zoneId = filters.zoneId;
  const roomCount = await roomCol.countDocuments(roomQuery as any);

  const days = Math.ceil(
    (filters.endDate.getTime() - filters.startDate.getTime()) / (24 * 3600 * 1000)
  ) + 1;

  const availableMinutes = roomCount * offPeakHoursPerDay * 60 * days;
  if (availableMinutes === 0) return 0;

  const resQuery = buildResQuery(filters, {
    status: { $in: ['confirmed', 'checked_in', 'completed'] },
  });
  const reservations = await resCol.find(resQuery as any).toArray() as any[];

  let bookedOffPeakMinutes = 0;
  const tz = config.site.timezone;
  for (const res of reservations) {
    // Compute minutes within business hours, then subtract peak minutes
    const businessMinutes = peakMinutesInWindow(res.startAtUtc, res.endAtUtc, openHour, closeHour, tz);
    const peak = peakMinutesInWindow(res.startAtUtc, res.endAtUtc, peakStart, peakEnd, tz);
    bookedOffPeakMinutes += Math.max(0, businessMinutes - peak);
  }

  return parseFloat((bookedOffPeakMinutes / availableMinutes).toFixed(4));
}

// ── computePolicyImpact ───────────────────────────────────────────────────────
export async function computePolicyImpact(
  policyVersionId: string,
  kpiName: KpiName,
  windowDays: number
): Promise<{ before: number; after: number; delta: number }> {
  const pvCol = getCollection('policy_versions');
  let oid: ObjectId;
  try {
    oid = new ObjectId(policyVersionId);
  } catch {
    throw new ValidationError('Invalid policy version ID');
  }

  const pv = await pvCol.findOne({ _id: oid } as any) as any;
  if (!pv) throw new NotFoundError('Policy version not found');

  const effectiveAt: Date = pv.effectiveAt;
  const windowMs = windowDays * 24 * 3600 * 1000;

  const beforeFilters: KpiFilters = {
    grain: 'day',
    startDate: new Date(effectiveAt.getTime() - windowMs),
    endDate: effectiveAt,
  };
  const afterFilters: KpiFilters = {
    grain: 'day',
    startDate: effectiveAt,
    endDate: new Date(effectiveAt.getTime() + windowMs),
  };

  const kpiMap: Record<KpiName, (f: KpiFilters) => Promise<number>> = {
    booking_conversion: computeBookingConversion,
    attendance_rate: computeAttendanceRate,
    noshow_rate: computeNoshowRate,
    peak_utilization: computePeakUtilization,
    offpeak_utilization: computeOffPeakUtilization,
  };

  const fn = kpiMap[kpiName];
  if (!fn) throw new ValidationError(`Unknown KPI: ${kpiName}`);

  const [before, after] = await Promise.all([fn(beforeFilters), fn(afterFilters)]);
  const delta = parseFloat((after - before).toFixed(4));

  return { before, after, delta };
}

// ── createSnapshot ────────────────────────────────────────────────────────────
export async function createSnapshot(
  kpiName: string,
  grain: Grain,
  periodStart: Date,
  periodEnd: Date,
  value: number,
  metadata: Record<string, unknown>,
  roomId?: string,
  zoneId?: string,
  policyVersionId?: string
): Promise<AnalyticsSnapshotDoc> {
  const col = getCollection('analytics_snapshots');
  const now = new Date();

  const doc: any = {
    kpiName,
    grain,
    periodStart,
    periodEnd,
    value,
    metadata,
    createdAt: now,
  };
  if (roomId) doc.roomId = roomId;
  if (zoneId) doc.zoneId = zoneId;
  if (policyVersionId) doc.policyVersionId = policyVersionId;

  const result = await col.insertOne(doc);
  return col.findOne({ _id: result.insertedId }) as unknown as AnalyticsSnapshotDoc;
}

// ── getSnapshots ──────────────────────────────────────────────────────────────
export async function getSnapshots(
  filters: {
    kpiName?: string;
    grain?: string;
    roomId?: string;
    zoneId?: string;
    startDate?: Date;
    endDate?: Date;
  },
  page: number,
  pageSize: number
): Promise<{ snapshots: AnalyticsSnapshotDoc[]; total: number }> {
  const col = getCollection('analytics_snapshots');
  const query: Record<string, unknown> = {};

  if (filters.kpiName) query.kpiName = filters.kpiName;
  if (filters.grain) query.grain = filters.grain;
  if (filters.roomId) query.roomId = filters.roomId;
  if (filters.zoneId) query.zoneId = filters.zoneId;
  if (filters.startDate || filters.endDate) {
    const df: Record<string, Date> = {};
    if (filters.startDate) df.$gte = filters.startDate;
    if (filters.endDate) df.$lte = filters.endDate;
    query.periodStart = df;
  }

  const total = await col.countDocuments(query as any);
  const snapshots = await col
    .find(query as any)
    .sort({ periodStart: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as AnalyticsSnapshotDoc[];

  return { snapshots, total };
}
