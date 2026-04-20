import { getCollection } from '../config/db';
import {
  DEFAULT_SENSITIVE_WORDS,
  SPAM_MAX_POSTS_PER_HOUR,
  SPAM_MAX_POSTS_PER_DAY,
} from '@studyroomops/shared-policy';

// ── Sensitive Word Check ───────────────────────────────────────────────────────

/**
 * Loads sensitive words from the active policy_versions document (policyArea = 'content_safety').
 * Falls back to DEFAULT_SENSITIVE_WORDS when no active policy document exists.
 */
async function loadSensitiveWords(): Promise<string[]> {
  try {
    const col = getCollection('policy_versions');
    const policy = await col.findOne(
      { policyArea: 'content_safety' },
      { sort: { effectiveAt: -1 } }
    ) as any | null;

    if (policy && Array.isArray(policy.settings?.sensitiveWords) && policy.settings.sensitiveWords.length > 0) {
      return policy.settings.sensitiveWords as string[];
    }
  } catch {
    // Swallow DB errors; fall back to defaults
  }
  return DEFAULT_SENSITIVE_WORDS;
}

export async function checkSensitiveWords(
  text: string
): Promise<{ blocked: boolean; words: string[] }> {
  const words = await loadSensitiveWords();
  const lowerText = text.toLowerCase();
  const found: string[] = [];

  for (const word of words) {
    // Whole-word boundary match
    const pattern = new RegExp(`\\b${word.toLowerCase()}\\b`, 'i');
    if (pattern.test(lowerText)) {
      found.push(word);
    }
  }

  return { blocked: found.length > 0, words: found };
}

// ── Spam Limit Check ───────────────────────────────────────────────────────────

/**
 * Checks whether the given user has exceeded rolling spam limits.
 * Limits: SPAM_MAX_POSTS_PER_HOUR (5) per rolling hour, SPAM_MAX_POSTS_PER_DAY (20) per rolling day.
 * Returns { allowed: true } when within limits.
 * Returns { allowed: false, nextAllowedAt } when a limit is hit.
 */
export async function checkSpamLimit(
  userId: string
): Promise<{ allowed: boolean; nextAllowedAt?: Date }> {
  const col = getCollection('community_post_log');
  const now = new Date();

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Fetch posts in the last 24 hours (superset covers both windows)
  const recentPosts = await col
    .find({ userId, createdAt: { $gte: oneDayAgo } })
    .sort({ createdAt: 1 })
    .toArray() as any[];

  const postsInHour = recentPosts.filter((p: any) => new Date(p.createdAt) >= oneHourAgo);
  const postsInDay = recentPosts;

  // Check hourly limit
  if (postsInHour.length >= SPAM_MAX_POSTS_PER_HOUR) {
    // Next allowed = oldest post within the hour + 1 hour
    const oldest = postsInHour[0];
    const nextAllowedAt = new Date(new Date(oldest.createdAt).getTime() + 60 * 60 * 1000);
    return { allowed: false, nextAllowedAt };
  }

  // Check daily limit
  if (postsInDay.length >= SPAM_MAX_POSTS_PER_DAY) {
    const oldest = postsInDay[0];
    const nextAllowedAt = new Date(new Date(oldest.createdAt).getTime() + 24 * 60 * 60 * 1000);
    return { allowed: false, nextAllowedAt };
  }

  return { allowed: true };
}

/**
 * Records a community post event for spam-rate-limiting purposes.
 * Fire-and-forget; callers do not need to await.
 */
export async function recordPost(userId: string): Promise<void> {
  const col = getCollection('community_post_log');
  await col.insertOne({ userId, createdAt: new Date() } as any);
}
