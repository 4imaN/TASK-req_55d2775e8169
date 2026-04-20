import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiGet, apiPost } from '../../utils/api';

interface Export {
  _id: string;
  exportType: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  filters?: Record<string, unknown>;
  filePath?: string;
  fileHash?: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}

const EXPORT_TYPES = [
  { value: 'reservations', label: 'Reservations' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'leads', label: 'Leads' },
  { value: 'ledger', label: 'Ledger' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'policy_impact', label: 'Policy Impact' },
];

const STATUS_BADGE: Record<string, string> = {
  queued: 'badge-gray',
  running: 'badge-warning',
  completed: 'badge-success',
  failed: 'badge-danger',
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

function fmt(dt?: string) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ExportsPage() {
  const [exports, setExports] = useState<Export[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [fType, setFType] = useState('reservations');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fZoneId, setFZoneId] = useState('');
  const [fRoomId, setFRoomId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Polling for running exports
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchExports = useCallback(async () => {
    const res = await apiGet<Export[]>('/exports', { pageSize: '50' });
    if (res.ok && res.data) {
      setExports(res.data);
    } else if (loading) {
      setError(res.error?.message || 'Failed to load exports');
    }
    setLoading(false);
  }, [loading]);

  useEffect(() => {
    fetchExports();
  }, []);

  // Poll when any export is queued or running
  useEffect(() => {
    const hasActive = exports.some((e) => e.status === 'queued' || e.status === 'running');
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(fetchExports, 3000);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [exports, fetchExports]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    const filters: Record<string, unknown> = {};
    if (fDateFrom) filters.startDate = new Date(fDateFrom).toISOString();
    if (fDateTo) filters.endDate = new Date(fDateTo + 'T23:59:59').toISOString();
    if (fZoneId) filters.zoneId = fZoneId;
    if (fRoomId) filters.roomId = fRoomId;

    const res = await apiPost<Export>('/exports', { exportType: fType, filters });
    if (res.ok) {
      setSuccess('Export job created. It will be ready shortly.');
      fetchExports();
      setTimeout(() => setSuccess(''), 4000);
    } else {
      setFormError(res.error?.message || 'Failed to create export');
    }
    setSubmitting(false);
  }

  return (
    <div>
      <h1>Data Exports</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Create Export Form */}
      <div className="card mb-4">
        <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>New Export</h2>
        <form onSubmit={handleCreate}>
          {formError && <div className="alert alert-error">{formError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Export Type</label>
              <select value={fType} onChange={(e) => setFType(e.target.value)}>
                {EXPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Date From</label>
              <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Date To</label>
              <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Zone ID (optional)</label>
              <input type="text" value={fZoneId} onChange={(e) => setFZoneId(e.target.value)} placeholder="Zone ID..." />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Room ID (optional)</label>
              <input type="text" value={fRoomId} onChange={(e) => setFRoomId(e.target.value)} placeholder="Room ID..." />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? 'Creating...' : 'Create Export'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Exports List */}
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Export Jobs</h2>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading exports...</div>
      ) : exports.length === 0 ? (
        <div className="empty-state">
          <h3>No exports yet</h3>
          <p>Create an export job using the form above.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((ex) => (
                  <tr key={ex._id}>
                    <td>
                      <span className="badge badge-primary">
                        {EXPORT_TYPES.find((t) => t.value === ex.exportType)?.label || ex.exportType}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`badge ${STATUS_BADGE[ex.status] || 'badge-gray'}`}>
                          {STATUS_LABEL[ex.status] || ex.status}
                        </span>
                        {(ex.status === 'queued' || ex.status === 'running') && (
                          <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', margin: 0 }} />
                        )}
                      </div>
                      {ex.errorMessage && <span className="text-sm" style={{ color: 'var(--danger)' }}>{ex.errorMessage}</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(ex.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(ex.completedAt)}</td>
                    <td>
                      {ex.status === 'completed' ? (
                        <a
                          href={`/api/v1/exports/${ex._id}/download`}
                          className="btn btn-primary btn-sm"
                          download
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-gray text-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
