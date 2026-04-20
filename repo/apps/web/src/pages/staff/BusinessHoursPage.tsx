import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '../../utils/api';

interface BusinessHoursEntry {
  _id: string;
  scope: 'site' | 'zone' | 'room';
  scopeId: string | null;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isActive: boolean;
}

interface Zone {
  _id: string;
  name: string;
}

interface Room {
  _id: string;
  name: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function BusinessHoursPage() {
  const [hours, setHours] = useState<BusinessHoursEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'site' | 'zone' | 'room'>('site');
  const [filterScopeId, setFilterScopeId] = useState('');
  const [zones, setZones] = useState<Zone[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formDay, setFormDay] = useState(0);
  const [formOpen, setFormOpen] = useState('07:00');
  const [formClose, setFormClose] = useState('23:00');
  const [formScopeId, setFormScopeId] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch zones and rooms for selectors
  useEffect(() => {
    apiGet<Zone[]>('/zones', { pageSize: '200' }).then((res) => {
      if (res.ok && res.data) setZones(res.data);
    });
    apiGet<Room[]>('/rooms', { pageSize: '200' }).then((res) => {
      if (res.ok && res.data) setRooms(res.data);
    });
  }, []);

  // Reset scopeId filter when scope changes
  useEffect(() => {
    setFilterScopeId('');
  }, [scope]);

  const fetchHours = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { scope };
    if (scope !== 'site' && filterScopeId) params.scopeId = filterScopeId;
    const res = await apiGet<BusinessHoursEntry[]>('/business-hours', params);
    if (res.ok && res.data) setHours(res.data);
    setLoading(false);
  }, [scope, filterScopeId]);

  useEffect(() => { fetchHours(); }, [fetchHours]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (scope !== 'site' && !formScopeId) {
      setFormError(`Please select a ${scope} before saving.`);
      return;
    }

    setSubmitting(true);

    const res = await apiPost('/business-hours', {
      scope,
      scopeId: scope === 'site' ? null : formScopeId,
      dayOfWeek: formDay,
      openTime: formOpen,
      closeTime: formClose,
    });

    setSubmitting(false);
    if (res.ok) {
      setShowForm(false);
      fetchHours();
    } else {
      setFormError(res.error?.message || 'Failed to save');
    }
  };

  const openForm = () => {
    setFormError('');
    setFormScopeId('');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this business hours entry?')) return;
    const res = await apiDelete(`/business-hours/${id}`);
    if (res.ok) fetchHours();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Business Hours</h1>
        <button className="btn btn-primary" onClick={openForm}>
          Set Hours
        </button>
      </div>

      <div className="card mb-4">
        <div className="form-group" style={{ marginBottom: scope !== 'site' ? '1rem' : 0 }}>
          <label>Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'site' | 'zone' | 'room')}>
            <option value="site">Site Default</option>
            <option value="zone">Zone Override</option>
            <option value="room">Room Override</option>
          </select>
        </div>
        {scope === 'zone' && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Filter by Zone</label>
            <select value={filterScopeId} onChange={(e) => setFilterScopeId(e.target.value)}>
              <option value="">All Zones</option>
              {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
            </select>
          </div>
        )}
        {scope === 'room' && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Filter by Room</label>
            <select value={filterScopeId} onChange={(e) => setFilterScopeId(e.target.value)}>
              <option value="">All Rooms</option>
              {rooms.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Set Business Hours</h2>
            {formError && <div className="alert alert-error">{formError}</div>}
            <form onSubmit={handleSubmit}>
              {scope === 'zone' && (
                <div className="form-group">
                  <label>Zone <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <select value={formScopeId} onChange={(e) => setFormScopeId(e.target.value)} required>
                    <option value="">Select a zone...</option>
                    {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
                  </select>
                </div>
              )}
              {scope === 'room' && (
                <div className="form-group">
                  <label>Room <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <select value={formScopeId} onChange={(e) => setFormScopeId(e.target.value)} required>
                    <option value="">Select a room...</option>
                    {rooms.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Day of Week</label>
                <select value={formDay} onChange={(e) => setFormDay(parseInt(e.target.value))}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Open Time</label>
                <input type="time" value={formOpen} onChange={(e) => setFormOpen(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Close Time</label>
                <input type="time" value={formClose} onChange={(e) => setFormClose(e.target.value)} required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading...</div>
      ) : hours.length === 0 ? (
        <div className="empty-state">
          <h3>No business hours configured for this scope</h3>
          <p>Set business hours to control when rooms are available.</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Open</th>
                <th>Close</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h._id}>
                  <td>{DAYS[h.dayOfWeek]}</td>
                  <td>{h.openTime}</td>
                  <td>{h.closeTime}</td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(h._id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
