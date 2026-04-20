import { MongoClient, Db, Collection, Document } from 'mongodb';
import { config } from './index';

let client: MongoClient;
let db: Db;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongo.uri);
  await client.connect();
  db = client.db(config.mongo.dbName);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not connected. Call connectDb() first.');
  return db;
}

export function getClient(): MongoClient {
  if (!client) throw new Error('Database not connected. Call connectDb() first.');
  return client;
}

export function getCollection<T extends Document = Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

// ---------------------------------------------------------------------------
// Append-only collection guard for audit logs
// ---------------------------------------------------------------------------
// Returns a Proxy that allows insert and read operations but throws on any
// mutating operation that would modify or delete existing documents.
// This enforces immutability at the application layer — the hash chain provides
// tamper evidence, and this guard ensures the application code cannot
// accidentally or intentionally update/delete audit entries.

const BLOCKED_MUTATIONS = new Set([
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'drop',
  'rename',
  'bulkWrite',
]);

export function getAppendOnlyCollection<T extends Document = Document>(name: string): Collection<T> {
  const col = getDb().collection<T>(name);
  return new Proxy(col, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_MUTATIONS.has(prop)) {
        return () => {
          throw new Error(
            `Immutability violation: ${prop}() is not allowed on append-only collection "${name}". ` +
            'Audit logs are insert-only to preserve integrity.'
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
  }
}

// Bootstrap indexes for all collections
export async function bootstrapIndexes(): Promise<void> {
  const d = getDb();

  // Users
  await d.collection('users').createIndex(
    { username_ci: 1 },
    { unique: true, name: 'idx_users_username_ci' }
  );

  // Sessions
  await d.collection('sessions').createIndex(
    { userId: 1, status: 1 },
    { name: 'idx_sessions_user_status' }
  );
  await d.collection('sessions').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 30 * 24 * 3600, name: 'idx_sessions_ttl' }
  );

  // Zones
  await d.collection('zones').createIndex(
    { name: 1 },
    { unique: true, name: 'idx_zones_name' }
  );

  // Rooms
  await d.collection('rooms').createIndex(
    { zoneId: 1, name: 1 },
    { unique: true, name: 'idx_rooms_zone_name' }
  );
  await d.collection('rooms').createIndex(
    { isActive: 1 },
    { name: 'idx_rooms_active' }
  );

  // Business Hours
  await d.collection('business_hours').createIndex(
    { scope: 1, scopeId: 1, dayOfWeek: 1 },
    { name: 'idx_business_hours_scope_day' }
  );

  // Reservation Slices - critical unique index for conflict prevention
  await d.collection('reservation_slices').createIndex(
    { resourceId: 1, slotStartUtc: 1 },
    { unique: true, name: 'idx_slices_resource_slot_unique' }
  );

  // Reservations
  await d.collection('reservations').createIndex(
    { userId: 1, startAtUtc: 1, status: 1 },
    { name: 'idx_reservations_user_start_status' }
  );
  await d.collection('reservations').createIndex(
    { roomId: 1, startAtUtc: 1, status: 1 },
    { name: 'idx_reservations_room_start_status' }
  );
  await d.collection('reservations').createIndex(
    { userId: 1, idempotencyKey: 1 },
    { unique: true, name: 'idx_reservations_user_idempotency' }
  );

  // Favorites
  await d.collection('favorite_rooms').createIndex(
    { userId: 1, roomId: 1 },
    { unique: true, name: 'idx_favorites_user_room' }
  );

  // Share Links
  await d.collection('reservation_share_links').createIndex(
    { token: 1 },
    { unique: true, name: 'idx_share_links_token' }
  );

  // Leads
  await d.collection('leads').createIndex(
    { status: 1, lastActivityAt: 1, requesterUserId: 1 },
    { name: 'idx_leads_status_activity_requester' }
  );
  await d.collection('leads').createIndex(
    { requesterUserId: 1, idempotencyKey: 1 },
    { unique: true, name: 'idx_leads_user_idempotency' }
  );

  // Lead Status History
  await d.collection('lead_status_history').createIndex(
    { leadId: 1, createdAt: 1 },
    { name: 'idx_lead_history_lead_created' }
  );

  // Reviews
  await d.collection('reviews').createIndex(
    { roomId: 1, state: 1, createdAt: -1 },
    { name: 'idx_reviews_room_state_created' }
  );
  await d.collection('reviews').createIndex(
    { reservationId: 1 },
    { unique: true, name: 'idx_reviews_reservation' }
  );

  // Review Media
  await d.collection('review_media').createIndex(
    { reviewId: 1 },
    { name: 'idx_review_media_review' }
  );

  // Q&A Threads
  await d.collection('qa_threads').createIndex(
    { roomId: 1, state: 1, isPinned: -1, createdAt: -1 },
    { name: 'idx_qa_threads_room_state_pinned' }
  );

  // Q&A Posts
  await d.collection('qa_posts').createIndex(
    { threadId: 1, createdAt: 1 },
    { name: 'idx_qa_posts_thread_created' }
  );

  // Content Reports
  await d.collection('content_reports').createIndex(
    { status: 1, contentType: 1, contentId: 1 },
    { name: 'idx_reports_status_content' }
  );
  await d.collection('content_reports').createIndex(
    { reporterUserId: 1, contentType: 1, contentId: 1, status: 1 },
    { name: 'idx_reports_reporter_content_status' }
  );

  // Ledger Entries
  await d.collection('ledger_entries').createIndex(
    { userId: 1, createdAt: -1, type: 1 },
    { name: 'idx_ledger_user_created_type' }
  );
  await d.collection('ledger_entries').createIndex(
    { userId: 1, idempotencyKey: 1 },
    { unique: true, sparse: true, name: 'idx_ledger_user_idempotency' }
  );

  // Membership Accounts
  await d.collection('membership_accounts').createIndex(
    { userId: 1 },
    { unique: true, name: 'idx_membership_accounts_user' }
  );

  // Face Events with TTL
  await d.collection('face_events').createIndex(
    { cameraId: 1, occurredAt: -1, decision: 1 },
    { name: 'idx_face_events_camera_occurred_decision' }
  );
  await d.collection('face_events').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'idx_face_events_ttl' }
  );

  // Face Enrollments
  await d.collection('face_enrollments').createIndex(
    { userId: 1 },
    { name: 'idx_face_enrollments_user' }
  );

  // Notifications
  await d.collection('notifications').createIndex(
    { userId: 1, readAt: 1, dueAt: -1 },
    { name: 'idx_notifications_user_read_due' }
  );
  // TTL index: MongoDB auto-deletes documents once expiresAt is past
  await d.collection('notifications').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'idx_notifications_ttl' }
  );

  // Audit Logs
  await d.collection('audit_logs').createIndex(
    { createdAt: -1, actorUserId: 1, objectType: 1, objectId: 1 },
    { name: 'idx_audit_logs_created_actor_object' }
  );

  // Background Jobs
  await d.collection('background_jobs').createIndex(
    { status: 1, nextRetryAt: 1 },
    { name: 'idx_background_jobs_status_retry' }
  );

  // Policy Versions
  await d.collection('policy_versions').createIndex(
    { policyArea: 1, effectiveAt: -1 },
    { name: 'idx_policy_versions_area_effective' }
  );

  // Attachments
  await d.collection('attachments').createIndex(
    { parentType: 1, parentId: 1 },
    { name: 'idx_attachments_parent' }
  );
  await d.collection('attachments').createIndex(
    { sha256Hash: 1 },
    { name: 'idx_attachments_hash' }
  );

  // Blacklist Actions
  await d.collection('blacklist_actions').createIndex(
    { userId: 1, clearedAt: 1 },
    { name: 'idx_blacklist_user_cleared' }
  );

  // Charge Disputes
  await d.collection('charge_disputes').createIndex(
    { userId: 1, status: 1 },
    { name: 'idx_disputes_user_status' }
  );

  // Analytics Snapshots
  await d.collection('analytics_snapshots').createIndex(
    { kpiName: 1, grain: 1, periodStart: 1, roomId: 1, zoneId: 1 },
    { name: 'idx_analytics_kpi_grain_period' }
  );

  // Export Jobs
  await d.collection('export_jobs').createIndex(
    { requestedByUserId: 1, status: 1 },
    { name: 'idx_export_jobs_user_status' }
  );

  // Camera Devices
  await d.collection('camera_devices').createIndex(
    { deviceIdentifier: 1 },
    { unique: true, name: 'idx_cameras_device_id' }
  );

  // Spam tracking (community post counts)
  await d.collection('community_post_log').createIndex(
    { userId: 1, createdAt: -1 },
    { name: 'idx_post_log_user_created' }
  );

  // Reputation snapshots
  await d.collection('reputation_snapshots').createIndex(
    { userId: 1, computedAt: -1 },
    { name: 'idx_reputation_user_computed' }
  );

  // Check-in events
  await d.collection('check_in_events').createIndex(
    { reservationId: 1 },
    { name: 'idx_checkin_reservation' }
  );

  // Content Appeals
  await d.collection('content_appeals').createIndex(
    { appellantUserId: 1, status: 1 },
    { name: 'idx_content_appeals_appellant_status' }
  );
  await d.collection('content_appeals').createIndex(
    { contentType: 1, contentId: 1 },
    { name: 'idx_content_appeals_content' }
  );

  // Moderation Actions
  await d.collection('moderation_actions').createIndex(
    { contentType: 1, contentId: 1, createdAt: -1 },
    { name: 'idx_moderation_actions_content_created' }
  );
  await d.collection('moderation_actions').createIndex(
    { actorUserId: 1, createdAt: -1 },
    { name: 'idx_moderation_actions_actor_created' }
  );

  // Reservation Attempts (analytics counter)
  await d.collection('reservation_attempts').createIndex(
    { userId: 1, roomId: 1, attemptedAt: -1 },
    { name: 'idx_reservation_attempts_user_room_time' }
  );
  await d.collection('reservation_attempts').createIndex(
    { attemptedAt: -1 },
    { name: 'idx_reservation_attempts_time' }
  );

  console.log('[DB] All indexes bootstrapped.');
}
