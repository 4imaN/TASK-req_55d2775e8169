import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from '../../utils/api';

interface Zone {
  _id: string;
  name: string;
}

interface Room {
  _id: string;
  name: string;
  zoneId: string;
}

interface Reservation {
  _id: string;
  roomId: { _id: string; name: string } | string;
  zoneId: { _id: string; name: string } | string;
  userId: { _id: string; displayName: string } | string;
  startAtUtc: string;
  endAtUtc: string;
  status: string;
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
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function entityName(e: { _id: string; name?: string; displayName?: string } | string) {
  if (typeof e === 'object') return e.name || e.displayName || e._id;
  return e;
}

function isOverdue(r: Reservation) {
  return r.status === 'confirmed' && new Date(r.startAtUtc) < new Date();
}

export default function ReservationOpsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [zones, setZones] = useState<Zone[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const [filterRoom, setFilterRoom] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 15;

  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    apiGet<Zone[]>('/zones', { pageSize: '100' }).then((res) => {
      if (res.ok && res.data) setZones(res.data);
    });
    apiGet<Room[]>('/rooms', { pageSize: '200' }).then((res) => {
      if (res.ok && res.data) setRooms(res.data);
    });
  }, []);

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    setError('');
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (filterRoom) params.roomId = filterRoom;
    if (filterZone) params.zoneId = filterZone;
    if (filterStatus) params.status = filterStatus;
    if (filterDateFrom) params.startDate = new Date(filterDateFrom).toISOString();
    if (filterDateTo) params.endDate = new Date(filterDateTo + 'T23:59:59').toISOString();
    const res = await apiGet<Reservation[]>('/reservations', params);
    if (res.ok && res.data) {
      setReservations(res.data);
      setTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setError(res.error?.message || 'Failed to load reservations');
    }
    setLoading(false);
  }, [page, filterRoom, filterZone, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  async function handleCheckIn(id: string) {
    setCheckingIn(id);
    const res = await apiPost(`/reservations/${id}/check-in`);
    if (res.ok) {
      setSuccess('Checked in.');
      setTimeout(() => setSuccess(''), 3000);
      fetchReservations();
    } else {
      setError(res.error?.message || 'Check-in failed');
    }
    setCheckingIn(null);
  }

  async function handleCancel() {
    if (!selected) return;
    setActionLoading(true);
    const res = await apiPost(`/reservations/${selected._id}/cancel`, { reason: cancelReason });
    if (res.ok) {
      setSuccess('Reservation canceled.');
      setSelected(null);
      setCancelReason('');
      fetchReservations();
    } else {
      setError(res.error?.message || 'Cancel failed');
    }
    setActionLoading(false);
  }

  function clearFilters() {
    setFilterRoom('');
    setFilterZone('');
    setFilterStatus('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(1);
  }

  const totalPages = Math.ceil(total / pageSize);
  const filteredRooms = filterZone ? rooms.filter((r) => r.zoneId === filterZone) : rooms;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Reservation Operations</h1>
        <span className="text-sm text-gray">{total} total</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Filters */}
      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Zone</label>
            <select value={filterZone} onChange={(e) => { setFilterZone(e.target.value); setFilterRoom(''); setPage(1); }}>
              <option value="">All Zones</option>
              {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Room</label>
            <select value={filterRoom} onChange={(e) => { setFilterRoom(e.target.value); setPage(1); }}>
              <option value="">All Rooms</option>
              {filteredRooms.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>From Date</label>
            <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>To Date</label>
            <input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading reservations...</div>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <h3>No reservations found</h3>
          <p>Adjust filters to see results.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Room</th>
                    <th>Zone</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => {
                    const overdue = isOverdue(r);
                    return (
                      <tr key={r._id} style={{ background: overdue ? '#fff7ed' : undefined }}>
                        <td>{entityName(r.userId as { _id: string; displayName: string } | string)}</td>
                        <td>{entityName(r.roomId as { _id: string; name: string } | string)}</td>
                        <td>{entityName(r.zoneId as { _id: string; name: string } | string)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {fmt(r.startAtUtc)}
                          {overdue && (
                            <span className="badge badge-danger" style={{ marginLeft: '0.35rem', fontSize: '0.65rem' }}>
                              Overdue
                            </span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.endAtUtc)}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>
                            {STATUS_LABEL[r.status] || r.status}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            {r.status === 'confirmed' && (
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={checkingIn === r._id}
                                onClick={() => handleCheckIn(r._id)}
                              >
                                {checkingIn === r._id ? '...' : 'Check In'}
                              </button>
                            )}
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => { setSelected(r); setCancelReason(''); }}
                            >
                              Details
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

      {/* Detail / Cancel Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Reservation Detail</h2>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <div><strong>User:</strong> {entityName(selected.userId as { _id: string; displayName: string } | string)}</div>
              <div><strong>Room:</strong> {entityName(selected.roomId as { _id: string; name: string } | string)}</div>
              <div><strong>Zone:</strong> {entityName(selected.zoneId as { _id: string; name: string } | string)}</div>
              <div><strong>Start:</strong> {fmt(selected.startAtUtc)}</div>
              <div><strong>End:</strong> {fmt(selected.endAtUtc)}</div>
              <div>
                <strong>Status:</strong>{' '}
                <span className={`badge ${STATUS_BADGE[selected.status] || 'badge-gray'}`}>
                  {STATUS_LABEL[selected.status] || selected.status}
                </span>
              </div>
              {selected.notes && <div><strong>Notes:</strong> {selected.notes}</div>}
            </div>

            {selected.status === 'confirmed' && (
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

            <div className="modal-actions">
              {selected.status === 'confirmed' && (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={checkingIn === selected._id}
                    onClick={() => { handleCheckIn(selected._id); setSelected(null); }}
                  >
                    Check In
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={actionLoading} onClick={handleCancel}>
                    {actionLoading ? 'Canceling...' : 'Cancel Reservation'}
                  </button>
                </>
              )}
              <button className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
