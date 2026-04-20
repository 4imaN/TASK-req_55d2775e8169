import { ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getCollection } from '../config/db';
import { enqueueJob } from './jobQueue.service';
import { writeAuditLog } from './audit.service';
import { ValidationError, NotFoundError } from './auth.service';
import { EXPORT_JOB_TRANSITIONS } from '@studyroomops/shared-policy';

export type ExportType =
  | 'reservations'
  | 'attendance'
  | 'leads'
  | 'ledger'
  | 'analytics'
  | 'policy_impact';

export interface ExportJobDoc {
  _id: ObjectId;
  requestedByUserId: string;
  exportType: ExportType;
  filters: Record<string, unknown>;
  status: string;
  filePath: string | null;
  fileHash: string | null;
  errorMessage: string | null;
  jobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const EXPORT_DIR = process.env.EXPORT_DIR || '/tmp/studyroomops-exports';

function ensureExportDir(): void {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

// ── createExportJob ───────────────────────────────────────────────────────────
export async function createExportJob(
  userId: string,
  exportType: ExportType,
  filters: Record<string, unknown>
): Promise<ExportJobDoc> {
  const validTypes: ExportType[] = ['reservations', 'attendance', 'leads', 'ledger', 'analytics', 'policy_impact'];
  if (!validTypes.includes(exportType)) {
    throw new ValidationError(`Invalid export type. Must be one of: ${validTypes.join(', ')}`);
  }

  const col = getCollection('export_jobs');
  const now = new Date();

  const result = await col.insertOne({
    requestedByUserId: userId,
    exportType,
    filters,
    status: 'queued',
    filePath: null,
    fileHash: null,
    errorMessage: null,
    jobId: null,
    createdAt: now,
    updatedAt: now,
  } as any);

  const exportJobId = result.insertedId.toString();

  // Enqueue background job
  const bgJobId = await enqueueJob('export_job', { exportJobId }, 3);

  // Update with bgJobId
  await col.updateOne(
    { _id: result.insertedId } as any,
    { $set: { jobId: bgJobId, updatedAt: new Date() } } as any
  );

  await writeAuditLog({
    actorUserId: userId,
    actorRole: 'administrator',
    action: 'export.create',
    objectType: 'export_job',
    objectId: exportJobId,
    newValue: { exportType, filters },
    requestId: '',
  });

  return col.findOne({ _id: result.insertedId }) as unknown as ExportJobDoc;
}

// ── generateCsv ───────────────────────────────────────────────────────────────
async function generateCsv(exportType: ExportType, filters: Record<string, unknown>): Promise<string> {
  const rows: string[] = [];
  const generatedAt = new Date().toISOString();

  // Header comment rows
  rows.push(`# StudyRoomOps Export`);
  rows.push(`# Type: ${exportType}`);
  rows.push(`# Generated: ${generatedAt}`);
  rows.push(`# Filters: ${JSON.stringify(filters)}`);
  rows.push('');

  const startDate = filters.startDate ? new Date(filters.startDate as string) : new Date(0);
  const endDate = filters.endDate ? new Date(filters.endDate as string) : new Date();

  switch (exportType) {
    case 'reservations': {
      const col = getCollection('reservations');
      const query: Record<string, unknown> = {
        startAtUtc: { $gte: startDate, $lte: endDate },
      };
      if (filters.roomId) query.roomId = filters.roomId as string;
      if (filters.userId) query.userId = filters.userId as string;
      if (filters.status) query.status = filters.status as string;

      const docs = await col.find(query as any).sort({ startAtUtc: -1 }).toArray() as any[];
      rows.push('id,userId,roomId,status,startAtUtc,endAtUtc,durationMinutes,createdAt');
      for (const d of docs) {
        rows.push([
          d._id.toString(),
          d.userId,
          d.roomId,
          d.status,
          d.startAtUtc?.toISOString() ?? '',
          d.endAtUtc?.toISOString() ?? '',
          d.durationMinutes ?? '',
          d.createdAt?.toISOString() ?? '',
        ].join(','));
      }
      break;
    }

    case 'attendance': {
      const col = getCollection('reservations');
      const query: Record<string, unknown> = {
        startAtUtc: { $gte: startDate, $lte: endDate },
        status: { $in: ['checked_in', 'completed', 'expired_no_show'] },
      };
      if (filters.roomId) query.roomId = filters.roomId as string;

      const docs = await col.find(query as any).sort({ startAtUtc: -1 }).toArray() as any[];
      rows.push('id,userId,roomId,status,startAtUtc,endAtUtc,checkedInAt');
      for (const d of docs) {
        rows.push([
          d._id.toString(),
          d.userId,
          d.roomId,
          d.status,
          d.startAtUtc?.toISOString() ?? '',
          d.endAtUtc?.toISOString() ?? '',
          d.checkedInAt?.toISOString() ?? '',
        ].join(','));
      }
      break;
    }

    case 'leads': {
      const col = getCollection('leads');
      const query: Record<string, unknown> = {
        createdAt: { $gte: startDate, $lte: endDate },
      };
      if (filters.status) query.status = filters.status as string;

      const docs = await col.find(query as any).sort({ createdAt: -1 }).toArray() as any[];
      rows.push('id,requesterUserId,type,status,requirements,createdAt,updatedAt');
      for (const d of docs) {
        rows.push([
          d._id.toString(),
          d.requesterUserId,
          d.type,
          d.status,
          `"${(d.requirements || '').replace(/"/g, '""')}"`,
          d.createdAt?.toISOString() ?? '',
          d.updatedAt?.toISOString() ?? '',
        ].join(','));
      }
      break;
    }

    case 'ledger': {
      const col = getCollection('ledger_entries');
      const query: Record<string, unknown> = {
        createdAt: { $gte: startDate, $lte: endDate },
      };
      if (filters.userId) query.userId = filters.userId as string;
      if (filters.type) query.type = filters.type as string;

      const docs = await col.find(query as any).sort({ createdAt: -1 }).toArray() as any[];
      rows.push('id,userId,type,amountCents,description,referenceType,referenceId,runningBalanceCents,createdAt');
      for (const d of docs) {
        rows.push([
          d._id.toString(),
          d.userId,
          d.type,
          d.amountCents,
          `"${(d.description || '').replace(/"/g, '""')}"`,
          d.referenceType ?? '',
          d.referenceId ?? '',
          d.runningBalanceCents,
          d.createdAt?.toISOString() ?? '',
        ].join(','));
      }
      break;
    }

    case 'analytics': {
      const col = getCollection('analytics_snapshots');
      const query: Record<string, unknown> = {
        periodStart: { $gte: startDate, $lte: endDate },
      };
      if (filters.kpiName) query.kpiName = filters.kpiName as string;
      if (filters.grain) query.grain = filters.grain as string;
      if (filters.roomId) query.roomId = filters.roomId as string;
      if (filters.zoneId) query.zoneId = filters.zoneId as string;

      const docs = await col.find(query as any).sort({ periodStart: -1 }).toArray() as any[];
      rows.push('id,kpiName,grain,periodStart,periodEnd,roomId,zoneId,value,createdAt');
      for (const d of docs) {
        rows.push([
          d._id.toString(),
          d.kpiName,
          d.grain,
          d.periodStart?.toISOString() ?? '',
          d.periodEnd?.toISOString() ?? '',
          d.roomId ?? '',
          d.zoneId ?? '',
          d.value,
          d.createdAt?.toISOString() ?? '',
        ].join(','));
      }
      break;
    }

    case 'policy_impact': {
      const policyVersionId = filters.policyVersionId as string | undefined;
      const kpiName = filters.kpiName as string | undefined;
      const windowDays = parseInt((filters.windowDays as string) || '30', 10);

      if (!policyVersionId || !kpiName) {
        rows.push('policyVersionId,kpiName,windowDays,before,after,delta');
        rows.push('# Missing policyVersionId or kpiName filter');
        break;
      }

      // Import inline to avoid circular dependency
      const { computePolicyImpact } = await import('./analytics.service');
      const impact = await computePolicyImpact(policyVersionId, kpiName as any, windowDays);
      rows.push('policyVersionId,kpiName,windowDays,before,after,delta');
      rows.push([policyVersionId, kpiName, windowDays, impact.before, impact.after, impact.delta].join(','));
      break;
    }
  }

  return rows.join('\n');
}

// ── processExportJob ──────────────────────────────────────────────────────────
export async function processExportJob(jobId: string): Promise<void> {
  const col = getCollection('export_jobs');
  let oid: ObjectId;
  try {
    oid = new ObjectId(jobId);
  } catch {
    throw new ValidationError('Invalid export job ID');
  }

  const job = await col.findOne({ _id: oid } as any) as unknown as ExportJobDoc | null;
  if (!job) throw new NotFoundError('Export job not found');

  const allowed = EXPORT_JOB_TRANSITIONS[job.status] || [];
  if (!allowed.includes('running')) {
    throw new ValidationError(`Export job cannot be started from status '${job.status}'`);
  }

  // Mark running
  await col.updateOne(
    { _id: oid } as any,
    { $set: { status: 'running', updatedAt: new Date() } } as any
  );

  try {
    const csvContent = await generateCsv(job.exportType, job.filters);

    ensureExportDir();
    const filename = `export_${job.exportType}_${job._id.toString()}_${Date.now()}.csv`;
    const filePath = path.join(EXPORT_DIR, filename);

    fs.writeFileSync(filePath, csvContent, 'utf8');

    // Compute SHA-256 hash
    const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');

    await col.updateOne(
      { _id: oid } as any,
      {
        $set: {
          status: 'completed',
          filePath,
          fileHash,
          errorMessage: null,
          updatedAt: new Date(),
        },
      } as any
    );
  } catch (err: any) {
    await col.updateOne(
      { _id: oid } as any,
      {
        $set: {
          status: 'failed',
          errorMessage: err.message || 'Unknown error',
          updatedAt: new Date(),
        },
      } as any
    );
    throw err;
  }
}

// ── getExportJob ──────────────────────────────────────────────────────────────
export async function getExportJob(jobId: string): Promise<ExportJobDoc> {
  let oid: ObjectId;
  try {
    oid = new ObjectId(jobId);
  } catch {
    throw new ValidationError('Invalid export job ID');
  }

  const col = getCollection('export_jobs');
  const job = await col.findOne({ _id: oid } as any) as unknown as ExportJobDoc | null;
  if (!job) throw new NotFoundError('Export job not found');
  return job;
}

// ── listExportJobs ────────────────────────────────────────────────────────────
export async function listExportJobs(
  filters: { userId?: string; status?: string },
  page: number,
  pageSize: number
): Promise<{ jobs: ExportJobDoc[]; total: number }> {
  const col = getCollection('export_jobs');
  const query: Record<string, unknown> = {};

  if (filters.userId) query.requestedByUserId = filters.userId;
  if (filters.status) query.status = filters.status;

  const total = await col.countDocuments(query as any);
  const jobs = await col
    .find(query as any)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray() as unknown as ExportJobDoc[];

  return { jobs, total };
}
