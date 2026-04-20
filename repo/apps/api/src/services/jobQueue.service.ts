import { ObjectId } from 'mongodb';
import { getCollection } from '../config/db';

interface JobDoc {
  _id: ObjectId;
  jobType: string;
  payload: Record<string, unknown>;
  status: string;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const RETRY_DELAYS_MS = [
  0,          // attempt 1: immediate
  60 * 1000,  // attempt 2: +1 minute
  5 * 60 * 1000,  // attempt 3: +5 minutes
  15 * 60 * 1000, // attempt 4: +15 minutes
];

export async function enqueueJob(
  jobType: string,
  payload: Record<string, unknown>,
  maxAttempts: number = 4
): Promise<string> {
  const col = getCollection('background_jobs');
  const now = new Date();

  const result = await col.insertOne({
    jobType,
    payload,
    status: 'queued',
    leasedAt: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    maxAttempts,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
  } as any);

  return result.insertedId.toString();
}

export async function leaseNextJob(workerTypes?: string[]): Promise<JobDoc | null> {
  const col = getCollection('background_jobs');
  const now = new Date();

  const query: Record<string, unknown> = {
    status: 'queued',
    nextRetryAt: { $lte: now },
  };
  if (workerTypes && workerTypes.length > 0) {
    query.jobType = { $in: workerTypes };
  }

  const job = await col.findOneAndUpdate(
    query,
    {
      $set: {
        status: 'leased',
        leasedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        updatedAt: now,
      },
    },
    { sort: { nextRetryAt: 1 }, returnDocument: 'after' }
  );

  return job as unknown as JobDoc | null;
}

export async function markJobRunning(jobId: string): Promise<void> {
  const col = getCollection('background_jobs');
  await col.updateOne(
    { _id: new ObjectId(jobId) },
    {
      $set: { status: 'running', startedAt: new Date(), updatedAt: new Date() },
      $inc: { attemptCount: 1 },
    }
  );
}

export async function markJobSucceeded(jobId: string): Promise<void> {
  const col = getCollection('background_jobs');
  await col.updateOne(
    { _id: new ObjectId(jobId) },
    { $set: { status: 'succeeded', completedAt: new Date(), updatedAt: new Date() } }
  );
}

export async function markJobFailed(jobId: string, error: string, terminal: boolean): Promise<void> {
  const col = getCollection('background_jobs');
  const job = await col.findOne({ _id: new ObjectId(jobId) }) as unknown as JobDoc | null;
  if (!job) return;

  const attempts = job.attemptCount + 1;
  const isTerminal = terminal || attempts >= job.maxAttempts;

  if (isTerminal) {
    await col.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { status: 'failed_terminal', error, completedAt: new Date(), updatedAt: new Date() } }
    );
  } else {
    const delayMs = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
    const nextRetry = new Date(Date.now() + delayMs);

    await col.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          status: 'queued',
          error,
          nextRetryAt: nextRetry,
          leasedAt: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        },
      }
    );
  }
}

// Reclaim stale leased jobs
export async function reclaimStaleJobs(): Promise<number> {
  const col = getCollection('background_jobs');
  const now = new Date();

  const result = await col.updateMany(
    { status: 'leased', leaseExpiresAt: { $lt: now } },
    { $set: { status: 'queued', leasedAt: null, leaseExpiresAt: null, updatedAt: now } }
  );

  return result.modifiedCount;
}
