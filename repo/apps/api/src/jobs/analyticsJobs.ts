import { DateTime } from 'luxon';
import { config } from '../config';
import {
  computeBookingConversion,
  computeAttendanceRate,
  computeNoshowRate,
  computePeakUtilization,
  computeOffPeakUtilization,
  createSnapshot,
  KpiName,
  Grain,
} from '../services/analytics.service';
import { leaseNextJob, markJobRunning, markJobSucceeded, markJobFailed } from '../services/jobQueue.service';
import { processExportJob as runExportJob } from '../services/export.service';
import { logger } from '../utils/logger';

// ── processAnalyticsRollup ─────────────────────────────────────────────────────
// Daily job: computes all KPIs for yesterday and persists snapshots
export async function processAnalyticsRollup(): Promise<number> {
  const tz = config.site.timezone;
  const yesterday = DateTime.now().setZone(tz).minus({ days: 1 });

  const periodStart = yesterday.startOf('day').toJSDate();
  const periodEnd = yesterday.endOf('day').toJSDate();
  const grain: Grain = 'day';

  const filters = { grain, startDate: periodStart, endDate: periodEnd };

  const kpis: KpiName[] = [
    'booking_conversion',
    'attendance_rate',
    'noshow_rate',
    'peak_utilization',
    'offpeak_utilization',
  ];

  const computeFns: Record<KpiName, (f: typeof filters) => Promise<number>> = {
    booking_conversion: computeBookingConversion,
    attendance_rate: computeAttendanceRate,
    noshow_rate: computeNoshowRate,
    peak_utilization: computePeakUtilization,
    offpeak_utilization: computeOffPeakUtilization,
  };

  let created = 0;
  for (const kpiName of kpis) {
    try {
      const value = await computeFns[kpiName](filters);
      await createSnapshot(
        kpiName,
        grain,
        periodStart,
        periodEnd,
        value,
        { computedAt: new Date().toISOString() }
      );
      created++;
    } catch (err: any) {
      logger.error('analytics-rollup', { kpi: kpiName, error: err.message });
    }
  }

  if (created > 0) {
    logger.info('analytics-rollup', { date: yesterday.toISODate(), snapshotsCreated: created });
  }

  return created;
}

// ── processExportJobs ──────────────────────────────────────────────────────────
// Polls background_jobs for queued export jobs and processes them
export async function processExportJobs(): Promise<number> {
  let processed = 0;

  // Process up to 5 export jobs per cycle
  for (let i = 0; i < 5; i++) {
    const job = await leaseNextJob(['export_job']);
    if (!job) break;

    const jobId = job._id.toString();
    await markJobRunning(jobId);

    try {
      const exportJobId = job.payload.exportJobId as string;
      if (!exportJobId) {
        await markJobFailed(jobId, 'Missing exportJobId in payload', true);
        continue;
      }

      await runExportJob(exportJobId);
      await markJobSucceeded(jobId);
      processed++;
    } catch (err: any) {
      const isTerminal = job.attemptCount + 1 >= job.maxAttempts;
      await markJobFailed(jobId, err.message || 'Export job failed', isTerminal);

      logger.error('export-jobs', { jobId, error: err.message, attemptCount: job.attemptCount + 1 });
    }
  }

  return processed;
}
