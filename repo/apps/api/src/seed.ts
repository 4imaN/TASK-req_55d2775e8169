import argon2 from 'argon2';
import { connectDb, bootstrapIndexes, getCollection, closeDb } from './config/db';
import { seedDefaultBusinessHours } from './services/businessHours.service';

const ARGON2_OPTIONS = {
  type: argon2.argon2id as const,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

async function seed() {
  console.log('[Seed] Connecting to database...');
  await connectDb();
  await bootstrapIndexes();

  const usersCol = getCollection('users');
  const zonesCol = getCollection('zones');
  const roomsCol = getCollection('rooms');
  const membershipTiersCol = getCollection('membership_tiers');
  const membershipAccountsCol = getCollection('membership_accounts');
  const policyVersionsCol = getCollection('policy_versions');

  // Check if already seeded
  const existingUsers = await usersCol.countDocuments();
  if (existingUsers > 0) {
    console.log('[Seed] Database already seeded. Skipping.');
    await closeDb();
    return;
  }

  const now = new Date();

  // ── Create Demo Users ──────────────────────────────────
  const users = [
    {
      username: 'alice',
      username_ci: 'alice',
      displayName: 'Alice Member',
      passwordHash: await argon2.hash('AlicePass12345', ARGON2_OPTIONS),
      roles: [],
      reputationTier: 'New',
      isActive: true,
      isDeleted: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      username: 'bob_creator',
      username_ci: 'bob_creator',
      displayName: 'Bob Creator',
      passwordHash: await argon2.hash('BobCreator12345', ARGON2_OPTIONS),
      roles: ['creator'],
      reputationTier: 'New',
      isActive: true,
      isDeleted: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      username: 'carol_mod',
      username_ci: 'carol_mod',
      displayName: 'Carol Moderator',
      passwordHash: await argon2.hash('CarolMod123456', ARGON2_OPTIONS),
      roles: ['moderator'],
      reputationTier: 'New',
      isActive: true,
      isDeleted: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      username: 'admin',
      username_ci: 'admin',
      displayName: 'System Administrator',
      passwordHash: await argon2.hash('AdminPass12345!', ARGON2_OPTIONS),
      roles: ['administrator'],
      reputationTier: 'New',
      isActive: true,
      isDeleted: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ];

  const userResults = await usersCol.insertMany(users as any);
  const userIds = Object.values(userResults.insertedIds).map((id) => id.toString());
  console.log(`[Seed] Created ${userIds.length} demo users`);

  // ── Create Zones ───────────────────────────────────────
  const zones = [
    { name: 'Ground Floor', description: 'Main entrance level with open study areas', isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { name: 'Second Floor', description: 'Quiet study zone with private rooms', isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { name: 'Basement', description: 'Group collaboration spaces', isActive: true, createdAt: now, updatedAt: now, version: 1 },
  ];

  const zoneResults = await zonesCol.insertMany(zones as any);
  const zoneIds = Object.values(zoneResults.insertedIds).map((id) => id.toString());
  console.log(`[Seed] Created ${zoneIds.length} zones`);

  // ── Create Rooms ───────────────────────────────────────
  const rooms = [
    { zoneId: zoneIds[0], name: 'Open Study A', description: 'Large open area with 20 desks', capacity: 20, amenities: ['wifi', 'power_outlets', 'whiteboard'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { zoneId: zoneIds[0], name: 'Open Study B', description: 'Smaller open area near entrance', capacity: 12, amenities: ['wifi', 'power_outlets'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { zoneId: zoneIds[1], name: 'Private Room 201', description: 'Sound-insulated room for 4', capacity: 4, amenities: ['wifi', 'power_outlets', 'projector', 'whiteboard'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { zoneId: zoneIds[1], name: 'Private Room 202', description: 'Sound-insulated room for 4', capacity: 4, amenities: ['wifi', 'power_outlets', 'projector', 'whiteboard'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { zoneId: zoneIds[1], name: 'Private Room 203', description: 'Corner room for 2 with window', capacity: 2, amenities: ['wifi', 'power_outlets', 'natural_light'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { zoneId: zoneIds[2], name: 'Collab Space 1', description: 'Flexible group workspace', capacity: 10, amenities: ['wifi', 'power_outlets', 'whiteboard', 'screen_share'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
    { zoneId: zoneIds[2], name: 'Collab Space 2', description: 'Flexible group workspace', capacity: 8, amenities: ['wifi', 'power_outlets', 'whiteboard'], isActive: true, createdAt: now, updatedAt: now, version: 1 },
  ];

  await roomsCol.insertMany(rooms as any);
  console.log(`[Seed] Created ${rooms.length} rooms`);

  // ── Create Default Membership Tier ─────────────────────
  const tierResult = await membershipTiersCol.insertOne({
    name: 'standard',
    description: 'Default membership tier',
    benefits: {
      maxReservationMinutes: 240,
      maxConcurrentReservations: 3,
      priorityBooking: false,
    },
    isDefault: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as any);
  const defaultTierId = tierResult.insertedId.toString();
  console.log('[Seed] Created default membership tier');

  // ── Create Membership Accounts for All Users ───────────
  const membershipDocs = userIds.map((userId) => ({
    userId,
    tierId: defaultTierId,
    walletBalanceCents: 0,
    pointsBalance: 0,
    isBlacklisted: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }));
  await membershipAccountsCol.insertMany(membershipDocs as any);
  console.log(`[Seed] Created ${membershipDocs.length} membership accounts`);

  // ── Seed Business Hours ────────────────────────────────
  await seedDefaultBusinessHours();
  console.log('[Seed] Created default business hours (07:00-23:00 daily)');

  // ── Create Default Policy Version ─────────────────────
  await policyVersionsCol.insertOne({
    policyArea: 'reservation',
    settings: {
      minReservationMinutes: 15,
      maxReservationMinutes: 240,
      noshowGraceMinutes: 15,
      checkinReminderMinutes: 10,
      checkinWindowBeforeMinutes: 15,
    },
    effectiveAt: now,
    createdByUserId: userIds[3], // admin
    createdAt: now,
  } as any);

  await policyVersionsCol.insertOne({
    policyArea: 'content_safety',
    settings: {
      sensitiveWords: ['spam', 'scam', 'phishing', 'malware', 'exploit'],
      maxPostsPerHour: 5,
      maxPostsPerDay: 20,
    },
    effectiveAt: now,
    createdByUserId: userIds[3],
    createdAt: now,
  } as any);

  await policyVersionsCol.insertOne({
    policyArea: 'wallet',
    settings: {
      dailyRiskLimitCents: 20000,
      pointsPerDollar: 1,
      pointsRedemptionBlock: 100,
      redemptionValueCents: 100,
    },
    effectiveAt: now,
    createdByUserId: userIds[3],
    createdAt: now,
  } as any);

  await policyVersionsCol.insertOne({
    policyArea: 'blacklist',
    settings: {
      noshowThreshold: 3,
      noshowWindowDays: 30,
      disputeThreshold: 2,
      disputeWindowDays: 180,
    },
    effectiveAt: now,
    createdByUserId: userIds[3],
    createdAt: now,
  } as any);

  await policyVersionsCol.insertOne({
    policyArea: 'analytics',
    settings: {
      peakStartTime: '09:00',
      peakEndTime: '17:00',
    },
    effectiveAt: now,
    createdByUserId: userIds[3],
    createdAt: now,
  } as any);

  console.log('[Seed] Created default policy versions');

  console.log('[Seed] ✓ Database seeded successfully');
  console.log('[Seed] Demo credentials:');
  console.log('  Regular User: alice / AlicePass12345');
  console.log('  Creator:      bob_creator / BobCreator12345');
  console.log('  Moderator:    carol_mod / CarolMod123456');
  console.log('  Administrator: admin / AdminPass12345!');

  await closeDb();
}

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
