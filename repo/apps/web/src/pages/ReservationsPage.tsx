import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

interface Reservation {
  _id: string;
  roomId: string;
  zoneId: string;
  userId: string;
  startAtUtc: string;
  endAtUtc: string;
  status: 'confirmed' | 'checked_in' | 'completed' | 'canceled' | 'expired_no_show';
  shareToken?: string;
  notes?: string;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'badge-primary',
  checked_in: 'badge-success',
  completed: 'badge-gray',
  canceled: 'badge-danger',
  expired_no_show: 'badge-warning',
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  checked_in: 'Checked In',
  completed: 'Completed',
  canceled: 'Canceled',
  expired_no_show: 'No-Show',
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isWithinCheckinWindow(startTime: string): boolean {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const diffMin = (start - now) / 60000;
  return diffMin <= 15 && diffMin >= -60;
}

export default function ReservationsPage() {
  const navigate = useNavigate();
  const { isStaff } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;
  const [roomMap, setRoomMap] = useState<Record<string, string>>({});
  const [zoneMap, setZoneMap] = useState<Record<string, string>>({});
  const lookupsFetched = useRef(false);

  const [selected, setSelected] = useState<Reservation | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    setError('');
    const params: Record<string, string> = { mine: 'true', page: String(page), pageSize: String(pageSize) };
    if (filterStatus) params.status = filterStatus;
    const res = await apiGet<Reservation[]>('/reservations', params);
    if (res.ok && res.data) {
      setReservations(res.data);
      setTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setError(res.error?.message || 'Failed to load reservations');
    }
    setLoading(false);
  }, [page, filterStatus]);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  // Fetch room and zone lookup maps once
  useEffect(() => {
    if (lookupsFetched.current) return;
    lookupsFetched.current = true;
    apiGet<{ _id: string; name: string }[]>('/rooms', { pageSize: '200' }).then((res) => {
      if (res.ok && res.data) {
        const m: Record<string, string> = {};
        for (const r of res.data) m[r._id] = r.name;
        setRoomMap(m);
      }
    });
    apiGet<{ _id: string; name: string }[]>('/zones', { pageSize: '200' }).then((res) => {
      if (res.ok && res.data) {
        const m: Record<string, string> = {};
        for (const z of res.data) m[z._id] = z.name;
        setZoneMap(m);
      }
    });
  }, []);

  async function handleCancel() {
    if (!selected) return;
    setCancelLoading(true);
    const body: Record<string, unknown> = { reason: cancelReason };
    const res = await apiPost(`/reservations/${selected._id}/cancel`, body);
    if (res.ok) {
      setSuccess('Reservation canceled.');
      setSelected(null);
      setCancelReason('');
      fetchReservations();
    } else {
      setError(res.error?.message || 'Cancel failed');
    }
    setCancelLoading(false);
  }

  async function handleCheckIn() {
    if (!selected) return;
    setCheckInLoading(true);
    const res = await apiPost(`/reservations/${selected._id}/check-in`);
    if (res.ok) {
      setSuccess('Checked in successfully.');
      setSelected(null);
      fetchReservations();
    } else {
      setError(res.error?.message || 'Check-in failed');
    }
    setCheckInLoading(false);
  }

  async function handleCreateShareLink() {
    if (!selected) return;
    setShareLoading(true);
    const res = await apiPost<{ token: string }>('/share-links', { reservationId: selected._id });
    if (res.ok && res.data) {
      const token = (res.data as { token?: string }).token || '';
      setShareToken(token);
      setSelected((prev) => prev ? { ...prev, shareToken: token } : null);
    } else {
      setError(res.error?.message || 'Failed to create share link');
    }
    setShareLoading(false);
  }

  function copyShareLink(token?: string) {
    if (!token) return;
    const url = `${window.location.origin}/shared/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Link copied!');
      setTimeout(() => setCopyMsg(''), 2000);
    });
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>My Reservations</h1>
        <button className="btn btn-primary" onClick={() => navigate('/rooms')}>
          + Book Room
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div className="flex items-center gap-4">
          <div className="form-group" style={{ marginBottom: 0, minWidth: '200px' }}>
            <label>Filter by Status</label>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading reservations...</div>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <h3>No reservations found</h3>
          <p>{filterStatus ? 'No reservations with this status.' : 'You have no reservations yet.'}</p>
          <button className="btn btn-primary mt-4" onClick={() => navigate('/rooms')}>Book a Room</button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Zone</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => (
                    <tr key={r._id}>
                      <td>{roomMap[r.roomId] || r.roomId}</td>
                      <td>{zoneMap[r.zoneId] || r.zoneId}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.startAtUtc)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.endAtUtc)}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(r); setShareToken(null); setCopyMsg(''); }}>
                          Details
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

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Reservation Details</h2>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
              <div><strong>Room:</strong> {roomMap[selected.roomId] || selected.roomId}</div>
              <div><strong>Zone:</strong> {zoneMap[selected.zoneId] || selected.zoneId}</div>
              <div><strong>Start:</strong> {fmt(selected.startAtUtc)}</div>
              <div><strong>End:</strong> {fmt(selected.endAtUtc)}</div>
              <div>
                <strong>Status:</strong>{' '}
                <span className={`badge ${STATUS_BADGE[selected.status] || 'badge-gray'}`}>
                  {STATUS_LABEL[selected.status] || selected.status}
                </span>
              </div>
              {selected.notes && <div><strong>Notes:</strong> {selected.notes}</div>}
              <div><strong>Booked:</strong> {fmt(selected.createdAt)}</div>
            </div>

            {selected.status === 'confirmed' && isStaff && (
              <div className="form-group">
                <label>Cancel Reason</label>
                <textarea
                  rows={2}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Reason for cancellation..."
                />
              </div>
            )}

            {copyMsg && <div className="alert alert-success" style={{ padding: '0.4rem 0.75rem', marginBottom: '0.5rem' }}>{copyMsg}</div>}

            <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
              {(selected.shareToken || shareToken) ? (
                <button className="btn btn-secondary btn-sm" onClick={() => copyShareLink(shareToken || selected.shareToken)}>
                  Copy Share Link
                </button>
              ) : (
                <button className="btn btn-secondary btn-sm" disabled={shareLoading} onClick={handleCreateShareLink}>
                  {shareLoading ? 'Creating...' : 'Create Share Link'}
                </button>
              )}
              {selected.status === 'confirmed' && isWithinCheckinWindow(selected.startAtUtc) && (
                <button className="btn btn-primary btn-sm" disabled={checkInLoading} onClick={handleCheckIn}>
                  {checkInLoading ? 'Checking in...' : 'Check In'}
                </button>
              )}
              {selected.status === 'confirmed' && (
                <button className="btn btn-danger btn-sm" disabled={cancelLoading} onClick={handleCancel}>
                  {cancelLoading ? 'Canceling...' : 'Cancel Reservation'}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
