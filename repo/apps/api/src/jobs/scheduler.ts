import { processCheckinReminders, processNoshowExpiry, processReservationCompletion } from './reservationJobs';
import { reclaimStaleJobs } from '../services/jobQueue.service';
import { processLeadSlaReminders } from './leadJobs';
import { recomputeAllReputationsJob } from './moderationJobs';
import { processAnalyticsRollup, processExportJobs } from './analyticsJobs';
import {
  purgeExpiredFaceEvents,
  purgeExpiredSessions,
  purgeExpiredNotifications,
  purgeExpiredShareLinks,
  purgeOrphanAttachments,
  anonymizeDeletedUsers,
} from './retentionJobs';
import { logger } from '../utils/logger';

interface ScheduledTask {
  name: string;
  intervalMs: number;
  handler: () => Promise<number | void>;
  lastRun?: number;
}

const tasks: ScheduledTask[] = [
  {
    name: 'checkin-reminders',
    intervalMs: 60 * 1000, // Every minute
    handler: processCheckinReminders,
  },
  {
    name: 'noshow-expiry',
    intervalMs: 60 * 1000, // Every minute
    handler: processNoshowExpiry,
  },
  {
    name: 'reservation-completion',
    intervalMs: 60 * 1000, // Every minute
    handler: processReservationCompletion,
  },
  {
    name: 'reclaim-stale-jobs',
    intervalMs: 5 * 60 * 1000, // Every 5 minutes
    handler: reclaimStaleJobs,
  },
  {
    name: 'lead-sla-reminders',
    intervalMs: 5 * 60 * 1000, // Every 5 minutes
    handler: processLeadSlaReminders,
  },
  {
    name: 'recompute-all-reputations',
    intervalMs: 24 * 60 * 60 * 1000, // Every 24 hours
    handler: recomputeAllReputationsJob,
  },
  {
    name: 'analytics-rollup',
    intervalMs: 24 * 60 * 60 * 1000, // Every 24 hours (daily)
    handler: processAnalyticsRollup,
  },
  {
    name: 'export-jobs',
    intervalMs: 30 * 1000, // Every 30 seconds
    handler: processExportJobs,
  },
  // ── Retention / cleanup jobs (every 6 hours) ──────────────────────────────
  {
    name: 'purge-expired-face-events',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: purgeExpiredFaceEvents,
  },
  {
    name: 'purge-expired-sessions',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: purgeExpiredSessions,
  },
  {
    name: 'purge-expired-notifications',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: purgeExpiredNotifications,
  },
  {
    name: 'purge-expired-share-links',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: purgeExpiredShareLinks,
  },
  {
    name: 'purge-orphan-attachments',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: purgeOrphanAttachments,
  },
  {
    name: 'anonymize-deleted-users',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    handler: anonymizeDeletedUsers,
  },
];

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  logger.info('scheduler', { event: 'starting', taskCount: tasks.length });

  // Run immediately, then on interval
  runPendingTasks();

  intervalId = setInterval(runPendingTasks, 15 * 1000); // Check every 15 seconds
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info('scheduler', { event: 'stopped' });
}

async function runPendingTasks(): Promise<void> {
  const now = Date.now();

  for (const task of tasks) {
    if (!task.lastRun || now - task.lastRun >= task.intervalMs) {
      try {
        const result = await task.handler();
        task.lastRun = now;
        if (typeof result === 'number' && result > 0) {
          logger.info('scheduler', { task: task.name, processed: result });
        }
      } catch (err: any) {
        logger.error('scheduler', { task: task.name, error: err.message });
      }
    }
  }
}

// Register additional tasks dynamically
export function registerTask(name: string, intervalMs: number, handler: () => Promise<number | void>): void {
  tasks.push({ name, intervalMs, handler });
}
