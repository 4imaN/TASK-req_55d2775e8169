// StudyRoomOps Shared Types

// ── Roles ──────────────────────────────────────────────────
export type StaffRole = 'creator' | 'moderator' | 'administrator';
export type ReputationTier = 'New' | 'Trusted' | 'Expert';

// ── User ───────────────────────────────────────────────────
export interface User {
  _id: string;
  username: string;
  displayName: string;
  passwordHash?: never; // never exposed
  phone?: string;
  profileEncrypted?: string;
  roles: StaffRole[];
  reputationTier: ReputationTier;
  isActive: boolean;
  isDeleted: boolean;
  lockedUntil?: Date | null;
  failedLoginAttempts: number;
  lastFailedLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface UserCreatePayload {
  username: string;
  password: string;
  displayName: string;
  phone?: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface SessionRecord {
  _id: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date | null;
  status: 'active' | 'expired_idle' | 'expired_absolute' | 'revoked';
}

// ── Zones & Rooms ──────────────────────────────────────────
export interface Zone {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface Room {
  _id: string;
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

export interface BusinessHours {
  _id: string;
  scope: 'site' | 'zone' | 'room';
  scopeId?: string; // zoneId or roomId, null for site
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ── Reservations ───────────────────────────────────────────
export type ReservationStatus =
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'canceled'
  | 'expired_no_show';

export interface Reservation {
  _id: string;
  userId: string;
  roomId: string;
  zoneId: string;
  startAtUtc: Date;
  endAtUtc: Date;
  status: ReservationStatus;
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

export interface ReservationSlice {
  _id: string;
  resourceId: string; // roomId
  slotStartUtc: Date;
  reservationId: string;
}

export interface ReservationCreatePayload {
  roomId: string;
  startAtUtc: string; // ISO
  endAtUtc: string; // ISO
  idempotencyKey: string;
}

export type ConflictReason =
  | 'outside_business_hours'
  | 'past_time_not_allowed'
  | 'duration_invalid'
  | 'resource_inactive'
  | 'overlapping_existing_reservation'
  | 'blacklisted_user'
  | 'policy_restriction'
  | 'version_conflict';

export interface AlternativeSlot {
  roomId: string;
  zoneId: string;
  start: string;
  end: string;
}

// ── Favorites & Share Links ────────────────────────────────
export interface FavoriteRoom {
  _id: string;
  userId: string;
  roomId: string;
  createdAt: Date;
}

export interface ReservationShareLink {
  _id: string;
  reservationId: string;
  createdByUserId: string;
  token: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
}

// ── Check-in ───────────────────────────────────────────────
export interface CheckInEvent {
  _id: string;
  reservationId: string;
  userId: string;
  source: 'manual' | 'staff' | 'vision';
  performedBy: string;
  createdAt: Date;
}

// ── Leads ──────────────────────────────────────────────────
export type LeadType = 'group_study' | 'long_term';
export type LeadStatus = 'New' | 'In Discussion' | 'Quoted' | 'Confirmed' | 'Closed';

export interface Lead {
  _id: string;
  requesterUserId: string;
  leadType: LeadType;
  requirements: string;
  budgetCapCents: number;
  availabilityWindows: { start: string; end: string }[];
  contactPhone: string;
  contactPhoneDisplay?: string;
  status: LeadStatus;
  quoteAmountCents?: number;
  closeReason?: string;
  assignedToUserId?: string;
  lastActivityAt: Date;
  policyVersionId?: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface LeadStatusHistoryEntry {
  _id: string;
  leadId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  changedByUserId: string;
  reason?: string;
  createdAt: Date;
}

export interface LeadNote {
  _id: string;
  leadId: string;
  authorUserId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Attachments ────────────────────────────────────────────
export interface Attachment {
  _id: string;
  parentType: 'lead' | 'review' | 'appeal';
  parentId: string;
  uploadedByUserId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  encryptedPath: string;
  createdAt: Date;
}

// ── Reviews & Q&A ──────────────────────────────────────────
export type ContentState = 'visible' | 'collapsed' | 'removed';

export interface Review {
  _id: string;
  reservationId: string;
  roomId: string;
  authorUserId: string;
  rating: number; // 1-5
  text: string;
  isFeatured: boolean;
  state: ContentState;
  moderationLockedAt?: Date | null;
  policyVersionId?: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ReviewMedia {
  _id: string;
  reviewId: string;
  attachmentId: string;
  ordinal: number;
  createdAt: Date;
}

export interface QaThread {
  _id: string;
  roomId: string;
  authorUserId: string;
  title: string;
  body: string;
  isPinned: boolean;
  state: ContentState;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface QaPost {
  _id: string;
  threadId: string;
  authorUserId: string;
  body: string;
  state: ContentState;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ── Moderation ─────────────────────────────────────────────
export type ReportStatus = 'open' | 'under_review' | 'actioned' | 'dismissed';
export type AppealStatus = 'submitted' | 'under_review' | 'accepted' | 'denied';

export interface ContentReport {
  _id: string;
  reporterUserId: string;
  contentType: 'review' | 'qa_thread' | 'qa_post';
  contentId: string;
  reason: string;
  status: ReportStatus;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  outcome?: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ContentAppeal {
  _id: string;
  appellantUserId: string;
  moderationActionId: string;
  contentType: 'review' | 'qa_thread' | 'qa_post';
  contentId: string;
  reason: string;
  status: AppealStatus;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  outcome?: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ReputationSnapshot {
  _id: string;
  userId: string;
  tier: ReputationTier;
  approvedContributionsCount: number;
  upheldReports90d: number;
  upheldReports180d: number;
  computedAt: Date;
}

// ── Membership & Wallet ────────────────────────────────────
export interface MembershipTier {
  _id: string;
  name: string;
  description?: string;
  benefits: Record<string, unknown>;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface MembershipAccount {
  _id: string;
  userId: string;
  tierId: string;
  balanceCents: number;
  pointsBalance: number;
  isBlacklisted: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export type LedgerEntryType =
  | 'topup'
  | 'spend'
  | 'refund'
  | 'reversal'
  | 'points_redemption'
  | 'points_accrual';

export interface LedgerEntry {
  _id: string;
  userId: string;
  type: LedgerEntryType;
  amountCents: number;
  pointsAmount?: number;
  balanceAfterCents: number;
  pointsBalanceAfter?: number;
  referenceType?: string;
  referenceId?: string;
  description: string;
  policyVersionId?: string;
  idempotencyKey?: string;
  createdAt: Date;
}

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_user'
  | 'resolved_house'
  | 'rejected';

export interface ChargeDispute {
  _id: string;
  userId: string;
  ledgerEntryId: string;
  reason: string;
  status: DisputeStatus;
  internalNotes?: string;
  resolvedByUserId?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface BlacklistAction {
  _id: string;
  userId: string;
  reason: string;
  triggeredBy: 'auto_noshow' | 'auto_dispute' | 'manual';
  performedByUserId?: string;
  thresholdDetails?: Record<string, unknown>;
  expiresAt?: Date | null;
  clearedAt?: Date | null;
  clearedByUserId?: string;
  createdAt: Date;
}

// ── Vision ─────────────────────────────────────────────────
export interface CameraDevice {
  _id: string;
  deviceIdentifier: string;
  name: string;
  zoneId?: string;
  roomId?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface FaceEnrollment {
  _id: string;
  userId: string;
  encryptedEmbedding: string;
  sampleIndex: number;
  consentRecordedAt: Date;
  consentMetadata: Record<string, unknown>;
  createdAt: Date;
}

export type FaceEventDecision =
  | 'allowlist_match'
  | 'blocklist_match'
  | 'no_match'
  | 'ambiguous_match';

export interface FaceEvent {
  _id: string;
  cameraId: string;
  matchedUserId?: string;
  decision: FaceEventDecision;
  confidenceScore?: number;
  occurredAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

// ── Analytics ──────────────────────────────────────────────
export interface AnalyticsSnapshot {
  _id: string;
  kpiName: string;
  grain: 'daily' | 'weekly' | 'monthly';
  periodStart: Date;
  periodEnd: Date;
  roomId?: string;
  zoneId?: string;
  policyVersionId?: string;
  value: number;
  metadata?: Record<string, unknown>;
  computedAt: Date;
}

export type ExportJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired';

export interface ExportJob {
  _id: string;
  requestedByUserId: string;
  exportType: string;
  filters: Record<string, unknown>;
  status: ExportJobStatus;
  filePath?: string;
  fileHash?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// ── Background Jobs ────────────────────────────────────────
export type JobStatus =
  | 'queued'
  | 'leased'
  | 'running'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_terminal';

export interface BackgroundJob {
  _id: string;
  jobType: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  leasedAt?: Date | null;
  leaseExpiresAt?: Date | null;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── Notifications ──────────────────────────────────────────
export interface Notification {
  _id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
  readAt?: Date | null;
  dueAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

// ── Audit Logs ─────────────────────────────────────────────
export interface AuditLog {
  _id: string;
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

// ── Policy Versioning ──────────────────────────────────────
export interface PolicyVersion {
  _id: string;
  policyArea: string;
  settings: Record<string, unknown>;
  effectiveAt: Date;
  createdByUserId: string;
  createdAt: Date;
}

// ── API Response Envelope ──────────────────────────────────
export interface ApiSuccess<T = unknown> {
  ok: true;
  data: T;
  meta: {
    requestId: string;
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;
