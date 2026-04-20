// MongoDB replica set initialization script
// This is idempotent — safe to run multiple times.

// Try to initiate the replica set. If already initiated, this is a no-op.
try {
  var status = rs.status();
  print('Replica set already initialized: ' + status.set);
} catch (e) {
  print('Initializing replica set...');
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongo1:27017", priority: 2 },
      { _id: 1, host: "mongo2:27018", priority: 1 },
      { _id: 2, host: "mongo3:27019", priority: 1 }
    ]
  });
  print('Replica set initiation submitted.');
}

// Wait for the primary to be elected
print('Waiting for primary election...');
var attempts = 0;
while (attempts < 30) {
  try {
    var status = rs.status();
    var hasPrimary = status.members.some(function(m) { return m.stateStr === 'PRIMARY'; });
    if (hasPrimary) {
      print('Primary elected successfully.');
      break;
    }
  } catch (e) {
    // status may fail during init
  }
  sleep(1000);
  attempts++;
}

if (attempts >= 30) {
  print('WARNING: Primary election timed out. Seed service will retry on its own.');
}

// Create the database and collections (idempotent — createCollection on existing is a no-op)
var studyDb = db.getSiblingDB('studyroomops');

var collections = [
  'users', 'sessions', 'zones', 'rooms', 'business_hours',
  'reservations', 'reservation_slices', 'check_in_events',
  'favorite_rooms', 'reservation_share_links',
  'leads', 'lead_status_history', 'lead_notes', 'attachments',
  'reviews', 'review_media', 'qa_threads', 'qa_posts',
  'content_reports', 'content_appeals', 'moderation_actions',
  'reputation_snapshots',
  'membership_tiers', 'membership_accounts', 'ledger_entries',
  'charge_disputes', 'blacklist_actions',
  'camera_devices', 'face_enrollments', 'face_events',
  'analytics_snapshots', 'export_jobs', 'background_jobs',
  'notifications', 'audit_logs', 'policy_versions',
  'community_post_log', 'reservation_attempts'
];

collections.forEach(function(name) {
  try { studyDb.createCollection(name); } catch (e) { /* already exists */ }
});

print('StudyRoomOps database setup complete (' + collections.length + ' collections).');
