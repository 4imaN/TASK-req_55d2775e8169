import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../../utils/api';

interface AuditLog {
  _id: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  objectType: string;
  objectId: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  requestId: string;
  hash: string;
  createdAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function actionBadgeClass(action: string) {
  if (action.startsWith('create')) return 'badge-success';
  if (action.startsWith('update') || action.startsWith('edit')) return 'badge-warning';
  if (action.startsWith('delete') || action.startsWith('remove') || action.startsWith('ban')) return 'badge-danger';
  if (action.startsWith('login') || action.startsWith('logout') || action.startsWith('auth')) return 'badge-primary';
  return 'badge-gray';
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    const params: Record<string, string> = { page: String(page), pageSize: '25' };
    if (appliedFrom) params.startDate = new Date(appliedFrom).toISOString();
    if (appliedTo) {
      const to = new Date(appliedTo);
      to.setHours(23, 59, 59, 999);
      params.endDate = to.toISOString();
    }
    const res = await apiGet<AuditLog[]>('/audit-logs', params);
    if (res.ok && res.data) {
      setLogs(res.data);
      setTotal((res.meta as { total?: number })?.total || 0);
    } else {
      setError(res.error?.message || 'Failed to load audit logs');
    }
    setLoading(false);
  }, [page, appliedFrom, appliedTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const applyFilters = () => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    setPage(1);
  };

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setAppliedFrom('');
    setAppliedTo('');
    setPage(1);
  };

  const hasFilters = appliedFrom || appliedTo;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Audit Log</h1>
        {total > 0 && <span className="text-sm text-gray">{total.toLocaleString()} total entries</span>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div className="flex items-center gap-4" style={{ flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ width: '160px' }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ width: '160px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', paddingBottom: '0' }}>
            <button className="btn btn-primary btn-sm" onClick={applyFilters}>
              Apply
            </button>
            {hasFilters && (
              <button className="btn btn-secondary btn-sm" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </div>
        {hasFilters && (
          <div className="text-sm text-gray mt-2">
            Showing entries{appliedFrom ? ` from ${appliedFrom}` : ''}{appliedTo ? ` to ${appliedTo}` : ''}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading audit logs...
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <h3>No audit logs found</h3>
          <p>{hasFilters ? 'No entries match the selected date range.' : 'System actions will be recorded here.'}</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Role</th>
                    <th>Action</th>
                    <th>Object</th>
                    <th>Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const hasChanges = log.oldValue || log.newValue || log.reason;
                    const changeTooltip = JSON.stringify(
                      { oldValue: log.oldValue, newValue: log.newValue, reason: log.reason },
                      null,
                      2
                    );
                    return (
                      <tr key={log._id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--gray-500)' }}>
                          {formatDate(log.createdAt)}
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {log.actorUserId ? log.actorUserId.slice(-8) : 'system'}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>
                            {log.actorRole || '—'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${actionBadgeClass(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="text-sm">
                          {log.objectType ? (
                            <span>
                              <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>{log.objectType}</span>
                              {log.objectId && (
                                <span className="text-gray" style={{ marginLeft: '0.25rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                  {log.objectId.slice(-8)}
                                </span>
                              )}
                            </span>
                          ) : <span className="text-gray">—</span>}
                        </td>
                        <td className="text-sm text-gray" style={{ maxWidth: '200px' }}>
                          {hasChanges ? (
                            <span title={changeTooltip} style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                              {[
                                log.oldValue && 'old',
                                log.newValue && 'new',
                                log.reason && 'reason',
                              ].filter(Boolean).join(', ')}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {total > 25 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Prev
              </button>
              <span className="text-sm text-gray">Page {page} of {Math.ceil(total / 25)}</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page * 25 >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
