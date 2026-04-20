import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from '../../utils/api';

interface Zone { _id: string; name: string; }
interface Room {
  _id: string;
  zoneId: string;
  name: string;
  description?: string;
  capacity?: number;
  amenities: string[];
  isActive: boolean;
  version: number;
}

export default function RoomSetupPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [formZone, setFormZone] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCapacity, setFormCapacity] = useState('');
  const [formAmenities, setFormAmenities] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page), pageSize: '20' };
    if (filterZone) params.zoneId = filterZone;
    const res = await apiGet<Room[]>('/rooms', params);
    if (res.ok && res.data) {
      setRooms(res.data);
      setTotal((res.meta as any)?.total || 0);
    }
    setLoading(false);
  }, [page, filterZone]);

  const fetchZones = useCallback(async () => {
    const res = await apiGet<Zone[]>('/zones', { pageSize: '100' });
    if (res.ok && res.data) setZones(res.data);
  }, []);

  useEffect(() => { fetchZones(); }, [fetchZones]);
  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const openCreate = () => {
    setEditRoom(null);
    setFormZone(zones[0]?._id || '');
    setFormName('');
    setFormDesc('');
    setFormCapacity('');
    setFormAmenities('');
    setFormActive(true);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (room: Room) => {
    setEditRoom(room);
    setFormZone(room.zoneId);
    setFormName(room.name);
    setFormDesc(room.description || '');
    setFormCapacity(room.capacity?.toString() || '');
    setFormAmenities(room.amenities.join(', '));
    setFormActive(room.isActive);
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    const amenitiesList = formAmenities.split(',').map((a) => a.trim()).filter(Boolean);
    const capacity = formCapacity ? parseInt(formCapacity) : undefined;

    let res;
    if (editRoom) {
      res = await apiPut(`/rooms/${editRoom._id}`, {
        name: formName,
        description: formDesc,
        capacity,
        amenities: amenitiesList,
        isActive: formActive,
        version: editRoom.version,
      });
    } else {
      res = await apiPost('/rooms', {
        zoneId: formZone,
        name: formName,
        description: formDesc,
        capacity,
        amenities: amenitiesList,
      });
    }

    setSubmitting(false);
    if (res.ok) {
      setShowForm(false);
      fetchRooms();
    } else {
      setFormError(res.error?.message || 'Operation failed');
    }
  };

  const zoneName = (zoneId: string) => zones.find((z) => z._id === zoneId)?.name || zoneId;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Room Setup</h1>
        <button className="btn btn-primary" onClick={openCreate} disabled={zones.length === 0}>
          Create Room
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {zones.length === 0 && <div className="alert alert-warning">Create a zone first before adding rooms.</div>}

      <div className="card mb-4">
        <div className="flex items-center gap-4">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Filter by Zone</label>
            <select value={filterZone} onChange={(e) => { setFilterZone(e.target.value); setPage(1); }}>
              <option value="">All Zones</option>
              {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editRoom ? 'Edit Room' : 'Create Room'}</h2>
            {formError && <div className="alert alert-error">{formError}</div>}
            <form onSubmit={handleSubmit}>
              {!editRoom && (
                <div className="form-group">
                  <label>Zone</label>
                  <select value={formZone} onChange={(e) => setFormZone(e.target.value)} required>
                    {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Room Name</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={2} />
              </div>
              <div className="form-group">
                <label>Capacity</label>
                <input type="number" value={formCapacity} onChange={(e) => setFormCapacity(e.target.value)} min={1} />
              </div>
              <div className="form-group">
                <label>Amenities (comma-separated)</label>
                <input value={formAmenities} onChange={(e) => setFormAmenities(e.target.value)} placeholder="wifi, power_outlets, whiteboard" />
              </div>
              {editRoom && (
                <div className="form-group">
                  <label>
                    <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                    {' '}Active
                  </label>
                </div>
              )}
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
        <div className="loading"><div className="spinner" />Loading rooms...</div>
      ) : rooms.length === 0 ? (
        <div className="empty-state">
          <h3>No rooms found</h3>
          <p>Create rooms to start accepting reservations.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Zone</th>
                  <th>Capacity</th>
                  <th>Amenities</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room._id}>
                    <td><strong>{room.name}</strong></td>
                    <td>{zoneName(room.zoneId)}</td>
                    <td>{room.capacity || '-'}</td>
                    <td className="text-sm">{room.amenities.join(', ') || '-'}</td>
                    <td>
                      <span className={`badge ${room.isActive ? 'badge-success' : 'badge-gray'}`}>
                        {room.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(room)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 20 && (
            <div className="pagination">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span className="text-sm text-gray">Page {page} of {Math.ceil(total / 20)}</span>
              <button className="btn btn-secondary btn-sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
