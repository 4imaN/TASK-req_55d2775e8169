import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';
import { REPUTATION_TIERS } from '@studyroomops/shared-policy';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReputationResult {
  userId: string;
  tier: string;
  approvedContributionsCount: number;
  upheldReports90d: number;
  upheldReports180d: number;
  computedAt: Date;
}

// ── Compute Reputation For One User ──────────────────────────────────────────

export async function computeReputation(userId: string): Promise<ReputationResult> {
  const now = new Date();
  const ago90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const ago180 = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // Count visible contributions across reviews, qa_threads, qa_posts
  const [visibleReviews, visibleThreads, visiblePosts] = await Promise.all([
    getCollection('reviews').countDocuments({ userId, state: 'visible' }),
    getCollection('qa_threads').countDocuments({ userId, state: 'visible' }),
    getCollection('qa_posts').countDocuments({ userId, state: 'visible' }),
  ]);

  const approvedContributionsCount = visibleReviews + visibleThreads + visiblePosts;

  // Count upheld reports (content_reports where status = 'actioned' for this user's content)
  // We look across reviews, qa_threads, qa_posts for content authored by this user
  // and find actioned reports against them within the windows.
  const [upheldReports90d, upheldReports180d] = await Promise.all([
    countUpheldReportsForUser(userId, ago90),
    countUpheldReportsForUser(userId, ago180),
  ]);

  // Determine tier
  const tier = computeTier(approvedContributionsCount, upheldReports90d, upheldReports180d);

  // Persist tier on user document
  try {
    const oid = new ObjectId(userId);
    await getCollection('users').updateOne(
      { _id: oid as any },
      { $set: { reputationTier: tier, updatedAt: now } }
    );
  } catch {
    // Invalid ObjectId – do not throw
  }

  // Write reputation snapshot
  const snapshot: ReputationResult = {
    userId,
    tier,
    approvedContributionsCount,
    upheldReports90d,
    upheldReports180d,
    computedAt: now,
  };

  await getCollection('reputation_snapshots').insertOne(snapshot as any);

  return snapshot;
}

// ── Batch Recompute All Reputations ──────────────────────────────────────────

export async function recomputeAllReputations(): Promise<number> {
  const users = getCollection('users');
  const cursor = users.find({ isDeleted: { $ne: true } }, { projection: { _id: 1 } });

  let processed = 0;
  for await (const user of cursor) {
    try {
      await computeReputation(user._id.toString());
      processed++;
    } catch {
      // Log failure but keep going
    }
  }

  return processed;
}

// ── Reputation for Single User (used by moderation service) ──────────────────

export async function recomputeReputationForUser(userId: string): Promise<void> {
  await computeReputation(userId);
}

// ── Tier Logic ────────────────────────────────────────────────────────────────

function computeTier(
  contributions: number,
  upheld90d: number,
  upheld180d: number
): string {
  // Expert: >= 40 contributions, 0 upheld in 180d
  if (
    contributions >= REPUTATION_TIERS.Expert.minContributions &&
    upheld180d <= 0
  ) {
    return 'Expert';
  }

  // Trusted: >= 10 contributions, <= 1 upheld in 90d
  if (
    contributions >= REPUTATION_TIERS.Trusted.minContributions &&
    upheld90d <= REPUTATION_TIERS.Trusted.maxUpheldReports90d
  ) {
    return 'Trusted';
  }

  return 'New';
}

// ── Count Upheld Reports For A User ──────────────────────────────────────────

async function countUpheldReportsForUser(userId: string, since: Date): Promise<number> {
  const reports = getCollection('content_reports');

  // Find all content authored by this user across all content types
  // then find reports against those content items that were actioned within window

  const [reviewIds, threadIds, postIds] = await Promise.all([
    getCollection('reviews')
      .find({ userId }, { projection: { _id: 1 } })
      .toArray()
      .then((docs) => docs.map((d) => d._id.toString())),
    getCollection('qa_threads')
      .find({ userId }, { projection: { _id: 1 } })
      .toArray()
      .then((docs) => docs.map((d) => d._id.toString())),
    getCollection('qa_posts')
      .find({ userId }, { projection: { _id: 1 } })
      .toArray()
      .then((docs) => docs.map((d) => d._id.toString())),
  ]);

  // Build OR query for all content items
  const contentClauses = [
    ...reviewIds.map((id) => ({ contentType: 'review', contentId: id })),
    ...threadIds.map((id) => ({ contentType: 'qa_thread', contentId: id })),
    ...postIds.map((id) => ({ contentType: 'qa_post', contentId: id })),
  ];

  if (contentClauses.length === 0) return 0;

  const count = await reports.countDocuments({
    $or: contentClauses,
    status: 'actioned',
    updatedAt: { $gte: since },
  });

  return count;
}
