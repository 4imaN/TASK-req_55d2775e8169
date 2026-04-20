import { recomputeAllReputations, recomputeReputationForUser } from '../services/reputation.service';
import { logger } from '../utils/logger';

/**
 * Nightly batch job that recomputes reputation for all users.
 * Registered in the scheduler with a 24-hour interval.
 */
export async function recomputeAllReputationsJob(): Promise<number> {
  logger.info('moderation-jobs', { task: 'recompute-all-reputations', event: 'starting' });

  const count = await recomputeAllReputations();

  logger.info('moderation-jobs', { task: 'recompute-all-reputations', event: 'complete', usersProcessed: count });

  return count;
}

/**
 * Immediate reputation recompute for a single user after a moderation outcome changes.
 * Called fire-and-forget from moderation.service.ts; exported here for test coverage.
 */
export async function recomputeReputationAfterModeration(userId: string): Promise<void> {
  try {
    await recomputeReputationForUser(userId);
    logger.info('moderation-jobs', { task: 'recompute-user-reputation', userId });
  } catch (err: any) {
    logger.error('moderation-jobs', { task: 'recompute-user-reputation', userId, error: err.message });
  }
}
