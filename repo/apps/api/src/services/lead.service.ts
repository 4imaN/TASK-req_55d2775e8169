import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import {
  LEAD_TYPES,
  LEAD_STATUSES,
  LEAD_TRANSITIONS,
  validatePhone,
  normalizePhone,
} from '@studyroomops/shared-policy';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from './auth.service';
import { hasRole, isAdmin } from '../middleware/auth';

// ── Types ──────────────────────────────────────────────────────────────────

export type LeadType = typeof LEAD_TYPES[number];
export type LeadStatus = typeof LEAD_STATUSES[number];

export interface AvailabilityWindow {
  start: string; // ISO date-time string
  end: string;   // ISO date-time string
}

export interface LeadNote {
  noteId: string;
  authorUserId: string;
  content: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface LeadDoc {
  _id: ObjectId;
  requesterUserId: string;
  type: LeadType;
  requirements: string;
  budgetCapCents: number;
  availabilityWindows: AvailabilityWindow[];
  contactPhone: string;
  status: LeadStatus;
  quoteAmountCents?: number;
  closeReason?: string;
  notes: LeadNote[];
  idempotencyKey: string;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface LeadStatusHistoryDoc {
  _id: ObjectId;
  leadId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  changedByUserId: string;
  quoteAmountCents?: number;
  closeReason?: string;
  createdAt: Date;
}

export interface CreateLeadData {
  type: string;
  requirements: string;
  budgetCapCents: number;
  availabilityWindows: AvailabilityWindow[];
  contactPhone: string;
}

export interface LeadFilters {
  status?: string;
  type?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toPublicLead(doc: LeadDoc, userId: string, userRoles: string[]): Record<string, unknown> {
  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);
  return {
    _id: doc._id.toString(),
    requesterUserId: doc.requesterUserId,
    type: doc.type,
    requirements: doc.requirements,
    budgetCapCents: doc.budgetCapCents,
    availabilityWindows: doc.availabilityWindows,
    contactPhone: doc.contactPhone,
    status: doc.status,
    quoteAmountCents: doc.quoteAmountCents,
    closeReason: doc.closeReason,
    // Internal notes visible to staff only
    notes: isStaff
      ? doc.notes
      : doc.notes.filter((n) => !n.isInternal),
    lastActivityAt: doc.lastActivityAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    version: doc.version,
  };
}

// ── Service Functions ──────────────────────────────────────────────────────

export async function createLead(
  userId: string,
  data: CreateLeadData,
  idempotencyKey: string
): Promise<Record<string, unknown>> {
  // Validate type
  if (!data.type || !(LEAD_TYPES as readonly string[]).includes(data.type)) {
    throw new ValidationError(`Invalid lead type. Must be one of: ${LEAD_TYPES.join(', ')}`);
  }

  // Validate requirements
  if (!data.requirements || data.requirements.trim().length === 0) {
    throw new ValidationError('Requirements description is required');
  }
  if (data.requirements.trim().length < 10) {
    throw new ValidationError('Requirements must be at least 10 characters');
  }

  // Validate budget
  if (typeof data.budgetCapCents !== 'number' || data.budgetCapCents < 0) {
    throw new ValidationError('budgetCapCents must be a non-negative integer');
  }
  if (!Number.isInteger(data.budgetCapCents)) {
    throw new ValidationError('budgetCapCents must be an integer');
  }

  // Validate availability windows
  if (!Array.isArray(data.availabilityWindows) || data.availabilityWindows.length === 0) {
    throw new ValidationError('At least one availability window is required');
  }
  for (const window of data.availabilityWindows) {
    if (!window.start || !window.end) {
      throw new ValidationError('Each availability window must have start and end');
    }
    const startTs = new Date(window.start).getTime();
    const endTs = new Date(window.end).getTime();
    if (isNaN(startTs) || isNaN(endTs)) {
      throw new ValidationError('Availability window start and end must be valid ISO date-time strings');
    }
    if (startTs >= endTs) {
      throw new ValidationError('Availability window start must be before end');
    }
  }

  // Validate phone
  const phoneError = validatePhone(data.contactPhone);
  if (phoneError) throw new ValidationError(phoneError);
  const normalizedPhone = normalizePhone(data.contactPhone);

  // Idempotency check
  const leadsCol = getCollection('leads');
  const existing = await leadsCol.findOne({ idempotencyKey, requesterUserId: userId });
  if (existing) {
    const existingDoc = existing as unknown as LeadDoc;
    return toPublicLead(existingDoc, userId, []);
  }

  const now = new Date();
  const doc: Omit<LeadDoc, '_id'> = {
    requesterUserId: userId,
    type: data.type as LeadType,
    requirements: data.requirements.trim(),
    budgetCapCents: data.budgetCapCents,
    availabilityWindows: data.availabilityWindows,
    contactPhone: normalizedPhone,
    status: 'New',
    notes: [],
    idempotencyKey,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  let result;
  try {
    result = await leadsCol.insertOne(doc as any);
  } catch (err: any) {
    if (err.code === 11000 && err.keyPattern?.idempotencyKey) {
      // Race condition - return existing
      const race = await leadsCol.findOne({ idempotencyKey, requesterUserId: userId }) as unknown as LeadDoc;
      return toPublicLead(race, userId, []);
    }
    throw err;
  }

  // Write initial status history
  await getCollection('lead_status_history').insertOne({
    leadId: result.insertedId.toString(),
    fromStatus: null,
    toStatus: 'New',
    changedByUserId: userId,
    createdAt: now,
  } as any);

  return toPublicLead({ ...doc, _id: result.insertedId } as LeadDoc, userId, []);
}

export async function updateLeadStatus(
  leadId: string,
  newStatus: string,
  userId: string,
  userRoles: string[],
  quoteAmountCents?: number,
  closeReason?: string
): Promise<Record<string, unknown>> {
  // Validate new status
  if (!(LEAD_STATUSES as readonly string[]).includes(newStatus)) {
    throw new ValidationError(`Invalid status. Must be one of: ${LEAD_STATUSES.join(', ')}`);
  }

  const leadsCol = getCollection('leads');
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(leadId);
  } catch {
    throw new NotFoundError('Lead not found');
  }

  const lead = await leadsCol.findOne({ _id: objectId }) as unknown as LeadDoc | null;
  if (!lead) throw new NotFoundError('Lead not found');

  const currentStatus = lead.status;

  // Check transition is allowed
  const allowedNext = LEAD_TRANSITIONS[currentStatus] ?? [];
  if (!allowedNext.includes(newStatus)) {
    throw new ValidationError(
      `Cannot transition lead from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedNext.join(', ') || 'none'}`
    );
  }

  // Admin-only reopen from Closed
  if (currentStatus === 'Closed' && !isAdmin(userRoles)) {
    throw new ForbiddenError('Only administrators can reopen a closed lead');
  }

  // Require quote_amount_cents for Quoted or Confirmed
  if ((newStatus === 'Quoted' || newStatus === 'Confirmed') && (quoteAmountCents === undefined || quoteAmountCents === null)) {
    throw new ValidationError(`quoteAmountCents is required when setting status to '${newStatus}'`);
  }
  if (quoteAmountCents !== undefined && (!Number.isInteger(quoteAmountCents) || quoteAmountCents < 0)) {
    throw new ValidationError('quoteAmountCents must be a non-negative integer');
  }

  // Require closeReason for Closed
  if (newStatus === 'Closed' && (!closeReason || closeReason.trim().length === 0)) {
    throw new ValidationError('closeReason is required when closing a lead');
  }

  const now = new Date();
  const updateFields: Record<string, unknown> = {
    status: newStatus,
    lastActivityAt: now,
    updatedAt: now,
  };
  if (quoteAmountCents !== undefined) {
    updateFields.quoteAmountCents = quoteAmountCents;
  }
  if (newStatus === 'Closed' && closeReason) {
    updateFields.closeReason = closeReason.trim();
  }

  const updated = await leadsCol.findOneAndUpdate(
    { _id: objectId, version: lead.version },
    {
      $set: updateFields,
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new ConflictError('Lead was modified concurrently. Please retry.');
  }

  // Record history
  const historyEntry: Record<string, unknown> = {
    leadId: leadId,
    fromStatus: currentStatus,
    toStatus: newStatus,
    changedByUserId: userId,
    createdAt: now,
  };
  if (quoteAmountCents !== undefined) historyEntry.quoteAmountCents = quoteAmountCents;
  if (newStatus === 'Closed' && closeReason) historyEntry.closeReason = closeReason.trim();

  await getCollection('lead_status_history').insertOne(historyEntry as any);

  return toPublicLead(updated as unknown as LeadDoc, userId, userRoles);
}

export async function addLeadNote(
  leadId: string,
  userId: string,
  userRoles: string[],
  content: string
): Promise<Record<string, unknown>> {
  // Only staff can add notes
  if (!hasRole(userRoles, 'creator') && !isAdmin(userRoles)) {
    throw new ForbiddenError('Only staff can add internal notes to leads');
  }

  if (!content || content.trim().length === 0) {
    throw new ValidationError('Note content is required');
  }

  const leadsCol = getCollection('leads');
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(leadId);
  } catch {
    throw new NotFoundError('Lead not found');
  }

  const lead = await leadsCol.findOne({ _id: objectId }) as unknown as LeadDoc | null;
  if (!lead) throw new NotFoundError('Lead not found');

  const now = new Date();
  const note: LeadNote = {
    noteId: new ObjectId().toString(),
    authorUserId: userId,
    content: content.trim(),
    isInternal: true,
    createdAt: now,
  };

  const updated = await leadsCol.findOneAndUpdate(
    { _id: objectId },
    {
      $push: { notes: note } as any,
      $set: { lastActivityAt: now, updatedAt: now },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) throw new NotFoundError('Lead not found');

  return toPublicLead(updated as unknown as LeadDoc, userId, userRoles);
}

export async function getLeadById(
  leadId: string,
  userId: string,
  userRoles: string[]
): Promise<Record<string, unknown>> {
  const leadsCol = getCollection('leads');
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(leadId);
  } catch {
    throw new NotFoundError('Lead not found');
  }

  const lead = await leadsCol.findOne({ _id: objectId }) as unknown as LeadDoc | null;
  if (!lead) throw new NotFoundError('Lead not found');

  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);

  // Regular users can only view their own leads
  if (!isStaff && lead.requesterUserId !== userId) {
    throw new ForbiddenError('You do not have access to this lead');
  }

  return toPublicLead(lead, userId, userRoles);
}

export async function listLeads(
  userId: string,
  userRoles: string[],
  filters: LeadFilters,
  page: number,
  pageSize: number
): Promise<{ leads: Record<string, unknown>[]; total: number }> {
  const leadsCol = getCollection('leads');
  const isStaff = hasRole(userRoles, 'creator') || isAdmin(userRoles);

  const query: Record<string, unknown> = {};

  // Non-staff only see their own leads
  if (!isStaff) {
    query.requesterUserId = userId;
  }

  if (filters.status && (LEAD_STATUSES as readonly string[]).includes(filters.status)) {
    query.status = filters.status;
  }
  if (filters.type && (LEAD_TYPES as readonly string[]).includes(filters.type)) {
    query.type = filters.type;
  }

  const skip = (page - 1) * pageSize;
  const [docs, total] = await Promise.all([
    leadsCol.find(query).sort({ lastActivityAt: -1 }).skip(skip).limit(pageSize).toArray(),
    leadsCol.countDocuments(query),
  ]);

  const leads = (docs as unknown as LeadDoc[]).map((d) => toPublicLead(d, userId, userRoles));

  return { leads, total };
}

export async function getLeadHistory(leadId: string): Promise<Record<string, unknown>[]> {
  // Validate the lead exists
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(leadId);
  } catch {
    throw new NotFoundError('Lead not found');
  }

  const lead = await getCollection('leads').findOne({ _id: objectId });
  if (!lead) throw new NotFoundError('Lead not found');

  const history = await getCollection('lead_status_history')
    .find({ leadId })
    .sort({ createdAt: 1 })
    .toArray() as unknown as LeadStatusHistoryDoc[];

  return history.map((h) => {
    // Build a human-readable note from structured fields
    const parts: string[] = [];
    if (h.quoteAmountCents != null) parts.push(`Quote: $${(h.quoteAmountCents / 100).toFixed(2)}`);
    if (h.closeReason) parts.push(h.closeReason);
    const note = parts.join(' — ') || undefined;

    return {
      _id: h._id.toString(),
      leadId: h.leadId,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedByUserId: h.changedByUserId,
      quoteAmountCents: h.quoteAmountCents,
      closeReason: h.closeReason,
      note,
      createdAt: h.createdAt,
      changedAt: h.createdAt,
    };
  });
}
