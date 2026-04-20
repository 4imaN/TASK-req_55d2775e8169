// StudyRoomOps Shared Policy Constants and Validation Rules

// ── Username ───────────────────────────────────────────────
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function validateUsername(username: string): string | null {
  if (!username || username.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username may only contain letters, numbers, dots, underscores, and hyphens';
  }
  return null;
}

// ── Password ───────────────────────────────────────────────
export const PASSWORD_MIN_LENGTH = 12;

export function validatePassword(password: string): string | null {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  return null;
}

// ── Reservation ────────────────────────────────────────────
export const SLOT_INCREMENT_MINUTES = 15;
export const DEFAULT_MIN_RESERVATION_MINUTES = 15;
export const DEFAULT_MAX_RESERVATION_MINUTES = 240;
export const DEFAULT_NOSHOW_GRACE_MINUTES = 15;
export const DEFAULT_CHECKIN_REMINDER_MINUTES = 10;
export const DEFAULT_CHECKIN_WINDOW_BEFORE_MINUTES = 15;
export const ALTERNATIVE_SLOT_SEARCH_RANGE_MINUTES = 60;
export const MAX_ALTERNATIVE_SLOTS = 6;

export function isAlignedTo15Minutes(date: Date): boolean {
  return date.getMinutes() % 15 === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

// ── Business Hours ─────────────────────────────────────────
export const DEFAULT_BUSINESS_HOURS_START = '07:00';
export const DEFAULT_BUSINESS_HOURS_END = '23:00';

// ── Lead ───────────────────────────────────────────────────
export const LEAD_TYPES = ['group_study', 'long_term'] as const;
export const LEAD_STATUSES = ['New', 'In Discussion', 'Quoted', 'Confirmed', 'Closed'] as const;

export const LEAD_TRANSITIONS: Record<string, string[]> = {
  'New': ['In Discussion', 'Closed'],
  'In Discussion': ['Quoted', 'Closed'],
  'Quoted': ['In Discussion', 'Confirmed', 'Closed'],
  'Confirmed': ['Closed'],
  'Closed': ['In Discussion'], // admin-only reopen
};

export const LEAD_SLA_HOURS = 24;

// ── Phone Validation ───────────────────────────────────────
export const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function validatePhone(phone: string): string | null {
  if (!phone || !PHONE_PATTERN.test(phone)) {
    return 'Invalid phone number format';
  }
  return null;
}

// ── Review & Q&A ───────────────────────────────────────────
export const REVIEW_MIN_TEXT_LENGTH = 20;
export const REVIEW_MAX_TEXT_LENGTH = 2000;
export const REVIEW_MAX_IMAGES = 5;
export const REVIEW_EDIT_WINDOW_HOURS = 24;
export const QUESTION_MIN_LENGTH = 10;
export const QUESTION_MAX_LENGTH = 1000;
export const ANSWER_MIN_LENGTH = 1;
export const ANSWER_MAX_LENGTH = 2000;

// ── Content Safety ─────────────────────────────────────────
export const SPAM_MAX_POSTS_PER_HOUR = 5;
export const SPAM_MAX_POSTS_PER_DAY = 20;
export const APPEAL_WINDOW_DAYS = 7;

// Default sensitive words list (extend via admin policy)
export const DEFAULT_SENSITIVE_WORDS = [
  'spam', 'scam', 'phishing', 'malware', 'exploit',
];

// ── Reputation ─────────────────────────────────────────────
export const REPUTATION_TIERS = {
  New: {
    minContributions: 0,
    maxUpheldReports90d: Infinity,
    maxUpheldReports180d: Infinity,
  },
  Trusted: {
    minContributions: 10,
    maxUpheldReports90d: 1,
    maxUpheldReports180d: Infinity,
  },
  Expert: {
    minContributions: 40,
    maxUpheldReports90d: 0,
    maxUpheldReports180d: 0,
  },
} as const;

// ── Membership & Wallet ────────────────────────────────────
export const POINTS_PER_DOLLAR = 1;
export const POINTS_REDEMPTION_BLOCK = 100;
export const DEFAULT_REDEMPTION_VALUE_CENTS = 100; // 100 points = $1.00
export const DEFAULT_DAILY_RISK_LIMIT_CENTS = 20000; // $200.00

// ── Blacklist ──────────────────────────────────────────────
export const BLACKLIST_NOSHOW_THRESHOLD = 3;
export const BLACKLIST_NOSHOW_WINDOW_DAYS = 30;
export const BLACKLIST_DISPUTE_THRESHOLD = 2;
export const BLACKLIST_DISPUTE_WINDOW_DAYS = 180;

// ── File Upload ────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const REVIEW_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

// MIME magic bytes
export const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

// ── Face Recognition ───────────────────────────────────────
export const DEFAULT_FACE_CONFIDENCE_THRESHOLD = 0.82;
export const AMBIGUOUS_MATCH_MARGIN = 0.03;
export const MIN_ENROLLMENT_SAMPLES = 3;
export const AUTO_CHECKIN_THRESHOLD_BONUS = 0.05;
export const FACE_EVENT_RETENTION_DAYS = 30;

// ── Session ────────────────────────────────────────────────
export const SESSION_IDLE_EXPIRY_MINUTES = 30;
export const SESSION_ABSOLUTE_EXPIRY_HOURS = 12;
export const SESSION_REFRESH_THROTTLE_SECONDS = 60;

// ── Account Lockout ────────────────────────────────────────
export const LOCKOUT_MAX_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MINUTES = 15;
export const LOCKOUT_DURATION_MINUTES = 30;

// ── Retention ──────────────────────────────────────────────
export const RETENTION_FACE_EVENTS_DAYS = 30;
export const RETENTION_SESSIONS_DAYS = 30;
export const RETENTION_NOTIFICATIONS_DAYS = 90;
export const RETENTION_UGC_YEARS = 2;
export const RETENTION_RESERVATIONS_YEARS = 3;
export const RETENTION_FINANCIAL_YEARS = 7;
export const RETENTION_AUDIT_YEARS = 7;

// ── Reservation State Machine ──────────────────────────────
export const RESERVATION_TRANSITIONS: Record<string, string[]> = {
  confirmed: ['checked_in', 'canceled', 'expired_no_show'],
  checked_in: ['completed', 'canceled'], // canceled only by admin
  completed: [],
  canceled: [],
  expired_no_show: [],
};

// ── Share Link ─────────────────────────────────────────────
export const SHARE_LINK_EXPIRY_HOURS_AFTER_END = 24;

// ── Content State Machine ──────────────────────────────────
export const CONTENT_STATE_TRANSITIONS: Record<string, string[]> = {
  visible: ['collapsed', 'removed'],
  collapsed: ['visible', 'removed'],
  removed: ['visible'], // only via appeal
};

// ── Report State Machine ───────────────────────────────────
export const REPORT_STATE_TRANSITIONS: Record<string, string[]> = {
  open: ['under_review'],
  under_review: ['actioned', 'dismissed'],
  actioned: [],
  dismissed: [],
};

// ── Appeal State Machine ───────────────────────────────────
export const APPEAL_STATE_TRANSITIONS: Record<string, string[]> = {
  submitted: ['under_review'],
  under_review: ['accepted', 'denied'],
  accepted: [],
  denied: [],
};

// ── Dispute State Machine ──────────────────────────────────
export const DISPUTE_STATE_TRANSITIONS: Record<string, string[]> = {
  open: ['under_review', 'rejected'],
  under_review: ['resolved_user', 'resolved_house', 'rejected'],
  resolved_user: [],
  resolved_house: [],
  rejected: [],
};

// ── Export Job State Machine ───────────────────────────────
export const EXPORT_JOB_TRANSITIONS: Record<string, string[]> = {
  queued: ['running', 'failed'],
  running: ['completed', 'failed'],
  completed: ['expired'],
  failed: ['queued'], // retry
  expired: [],
};

// ── Background Job State Machine ───────────────────────────
export const BACKGROUND_JOB_TRANSITIONS: Record<string, string[]> = {
  queued: ['leased'],
  leased: ['running', 'queued'], // queued on lease timeout
  running: ['succeeded', 'failed_retryable', 'failed_terminal'],
  failed_retryable: ['queued'],
  failed_terminal: [],
  succeeded: [],
};
