import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../../utils/api';

interface BlacklistAction {
  _id: string;
  userId: { _id: string; displayName: string; username: string } | string;
  reason: string;
  triggeredBy: string;
  createdAt: string;
  expiresAt?: string;
  clearedAt?: string;
  clearedBy?: { displayName: string } | string;
}

function personName(u: { _id: string; displayName: string; username?: string } | string) {
  return typeof u === 'object' ? u.displayName : u;
}

function fmt(dt?: string) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BlacklistPage() {
  const [actions, setActions] = useState<BlacklistAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // Manual blacklist form
  const [showForm, setShowForm] = useState(false);
  const [fUserSearch, setFUserSearch] = useState('');
  const [fUserId, setFUserId] = useState('');
  const [fReason, setFReason] = useState('');
  const [fExpiry, setFExpiry] = useState('');
  const [fSubmitting, setFSubmitting] = useState(false);
  const [fError, setFError] = useState('');

  // User search results
  const [userResults, setUserResults] = useState<{ _id: string; displayName: string; username: string }[]>([]);
  const [searching, setSearching] = useState(false);

  // Clear action
  const [clearing, setClearing] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<BlacklistAction[]>('/blacklist', { page: String(page), pageSize: String(pageSize) });
    if (res.ok && res.data) {
      setActions(res.data);
      setTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setError(res.error?.message || 'Failed to load blacklist');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchActions(); }, [fetchActions]);

  async function searchUsers(query: string) {
    if (!query.trim()) { setUserResults([]); return; }
    setSearching(true);
    const res = await apiGet<{ _id: string; displayName: string; username: string }[]>('/users', { search: query, pageSize: '10' });
    if (res.ok && res.data) setUserResults(res.data);
    setSearching(false);
  }

  async function handleBlacklist() {
    if (!fUserId) { setFError('Select a user.'); return; }
    if (!fReason.trim()) { setFError('Reason is required.'); return; }
    setFSubmitting(true);
    setFError('');
    const body: Record<string, unknown> = { userId: fUserId, reason: fReason };
    if (fExpiry) body.expiresAt = new Date(fExpiry).toISOString();
    const res = await apiPost('/blacklist', body);
    if (res.ok) {
      setSuccess('User blacklisted.');
      setShowForm(false);
      setFUserId('');
      setFUserSearch('');
      setFReason('');
      setFExpiry('');
      setUserResults([]);
      fetchActions();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setFError(res.error?.message || 'Failed to blacklist user');
    }
    setFSubmitting(false);
  }

  async function handleClear(action: BlacklistAction) {
    const userId = typeof action.userId === 'object' ? action.userId._id : action.userId;
    setClearing(action._id);
    const res = await apiPost(`/blacklist/${userId}/clear`);
    if (res.ok) {
      setSuccess('Blacklist entry cleared.');
      fetchActions();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Failed to clear');
    }
    setClearing(null);
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Blacklist Controls</h1>
        <button className="btn btn-danger" onClick={() => { setShowForm(true); setFError(''); }}>
          + Blacklist User
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading blacklist...</div>
      ) : actions.length === 0 ? (
        <div className="empty-state">
          <h3>No blacklist entries</h3>
          <p>No users are currently blacklisted.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Reason</th>
                    <th>Triggered By</th>
                    <th>Date</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a._id}>
                      <td>{personName(a.userId)}</td>
                      <td style={{ maxWidth: '200px' }}>
                        <span style={{ fontSize: '0.85rem' }}>{a.reason}</span>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{a.triggeredBy}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(a.createdAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(a.expiresAt)}</td>
                      <td>
                        {a.clearedAt ? (
                          <span className="badge badge-gray">Cleared {fmt(a.clearedAt)}</span>
                        ) : (
                          <span className="badge badge-danger">Active</span>
                        )}
                      </td>
                      <td>
                        {!a.clearedAt && (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={clearing === a._id}
                            onClick={() => handleClear(a)}
                          >
                            {clearing === a._id ? '...' : 'Clear'}
                          </button>
                        )}
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

      {/* Blacklist Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Blacklist User</h2>
            {fError && <div className="alert alert-error">{fError}</div>}

            <div className="form-group">
              <label>User Search</label>
              <input
                type="text"
                value={fUserSearch}
                onChange={(e) => {
                  setFUserSearch(e.target.value);
                  setFUserId('');
                  searchUsers(e.target.value);
                }}
                placeholder="Search by username or display name..."
              />
              {searching && <div className="text-sm text-gray" style={{ marginTop: '0.25rem' }}>Searching...</div>}
              {userResults.length > 0 && !fUserId && (
                <div style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', marginTop: '0.25rem', background: 'white', maxHeight: '150px', overflowY: 'auto' }}>
                  {userResults.map((u) => (
                    <div
                      key={u._id}
                      style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.9rem' }}
                      onMouseOver={(e) => (e.currentTarget.style.background = 'var(--gray-50)')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'white')}
                      onClick={() => { setFUserId(u._id); setFUserSearch(u.displayName + ' (' + u.username + ')'); setUserResults([]); }}
                    >
                      {u.displayName} <span className="text-gray">@{u.username}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Reason</label>
              <textarea rows={3} value={fReason} onChange={(e) => setFReason(e.target.value)} placeholder="Why is this user being blacklisted?" />
            </div>

            <div className="form-group">
              <label>Expiry Date — optional (leave blank for permanent)</label>
              <input type="datetime-local" value={fExpiry} onChange={(e) => setFExpiry(e.target.value)} />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={fSubmitting} onClick={handleBlacklist}>
                {fSubmitting ? 'Blacklisting...' : 'Confirm Blacklist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
