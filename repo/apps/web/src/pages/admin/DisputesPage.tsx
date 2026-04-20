import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPut } from '../../utils/api';

interface Dispute {
  _id: string;
  userId: { _id: string; displayName: string } | string;
  amount: number;
  reason: string;
  status: 'open' | 'under_review' | 'resolved_user' | 'resolved_house' | 'rejected';
  internalNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-warning',
  under_review: 'badge-primary',
  resolved_user: 'badge-success',
  resolved_house: 'badge-success',
  rejected: 'badge-danger',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  under_review: 'Under Review',
  resolved_user: 'Resolved (User)',
  resolved_house: 'Resolved (House)',
  rejected: 'Rejected',
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['under_review', 'rejected'],
  under_review: ['resolved_user', 'resolved_house', 'rejected'],
  resolved_user: [],
  resolved_house: [],
  rejected: [],
};

function personName(u: { _id: string; displayName: string } | string) {
  return typeof u === 'object' ? u.displayName : u;
}

function fmt(dt?: string) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtAmount(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 15;

  const [selected, setSelected] = useState<Dispute | null>(null);
  const [noteText, setNoteText] = useState('');
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<Dispute[]>('/wallet/disputes', { page: String(page), pageSize: String(pageSize) });
    if (res.ok && res.data) {
      setDisputes(res.data);
      setTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setError(res.error?.message || 'Failed to load disputes');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  async function handleStatusChange(toStatus: string) {
    if (!selected) return;
    setTransitioning(toStatus);
    const res = await apiPut(`/wallet/disputes/${selected._id}`, {
      status: toStatus,
      internalNote: noteText,
    });
    if (res.ok) {
      setSuccess(`Dispute marked as ${STATUS_LABEL[toStatus]}.`);
      setSelected(null);
      setNoteText('');
      fetchDisputes();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Failed to update dispute');
    }
    setTransitioning(null);
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Charge Disputes</h1>
        <span className="text-sm text-gray">{total} total</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading disputes...</div>
      ) : disputes.length === 0 ? (
        <div className="empty-state">
          <h3>No disputes</h3>
          <p>No charge disputes have been filed.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.map((d) => (
                    <tr key={d._id}>
                      <td>{personName(d.userId)}</td>
                      <td>{fmtAmount(d.amount)}</td>
                      <td style={{ maxWidth: '220px' }}>
                        <span style={{ fontSize: '0.85rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.reason}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[d.status] || 'badge-gray'}`}>
                          {STATUS_LABEL[d.status] || d.status}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(d.createdAt)}</td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setSelected(d); setNoteText(d.internalNote || ''); }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span className="text-sm text-gray">Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Dispute Detail</h2>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <div><strong>User:</strong> {personName(selected.userId)}</div>
              <div><strong>Amount:</strong> {fmtAmount(selected.amount)}</div>
              <div><strong>Reason:</strong> {selected.reason}</div>
              <div>
                <strong>Status:</strong>{' '}
                <span className={`badge ${STATUS_BADGE[selected.status] || 'badge-gray'}`}>
                  {STATUS_LABEL[selected.status] || selected.status}
                </span>
              </div>
              <div><strong>Filed:</strong> {fmt(selected.createdAt)}</div>
              {selected.resolvedAt && <div><strong>Resolved:</strong> {fmt(selected.resolvedAt)}</div>}
            </div>

            <div className="form-group">
              <label>Internal Notes</label>
              <textarea
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add resolution notes..."
              />
            </div>

            {VALID_TRANSITIONS[selected.status]?.length > 0 && (
              <div>
                <p style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>Update Status</p>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {VALID_TRANSITIONS[selected.status].map((s) => (
                    <button
                      key={s}
                      className={`btn btn-sm ${s === 'resolved_user' || s === 'resolved_house' ? 'btn-primary' : s === 'rejected' ? 'btn-danger' : 'btn-secondary'}`}
                      disabled={transitioning === s}
                      onClick={() => handleStatusChange(s)}
                    >
                      {transitioning === s ? '...' : STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
