import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from '../../utils/api';

interface Zone {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  version: number;
}

export default function ZoneManagementPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editZone, setEditZone] = useState<Zone | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchZones = useCallback(async () => {
    setLoading(true);
    const res = await apiGet<Zone[]>('/zones', { pageSize: '100' });
    if (res.ok && res.data) {
      setZones(res.data);
    } else {
      setError(res.error?.message || 'Failed to load zones');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchZones(); }, [fetchZones]);

  const openCreate = () => {
    setEditZone(null);
    setFormName('');
    setFormDesc('');
    setFormActive(true);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (zone: Zone) => {
    setEditZone(zone);
    setFormName(zone.name);
    setFormDesc(zone.description || '');
    setFormActive(zone.isActive);
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    let res;
    if (editZone) {
      res = await apiPut(`/zones/${editZone._id}`, {
        name: formName,
        description: formDesc,
        isActive: formActive,
        version: editZone.version,
      });
    } else {
      res = await apiPost('/zones', { name: formName, description: formDesc });
    }

    setSubmitting(false);

    if (res.ok) {
      setShowForm(false);
      fetchZones();
    } else {
      setFormError(res.error?.message || 'Operation failed');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Loading zones...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Zone Management</h1>
        <button className="btn btn-primary" onClick={openCreate}>Create Zone</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editZone ? 'Edit Zone' : 'Create Zone'}</h2>
            {formError && <div className="alert alert-error">{formError}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Zone Name</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={3} />
              </div>
              {editZone && (
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

      {zones.length === 0 ? (
        <div className="empty-state">
          <h3>No zones yet</h3>
          <p>Create your first zone to start setting up rooms.</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone._id}>
                  <td><strong>{zone.name}</strong></td>
                  <td className="text-sm text-gray">{zone.description || '-'}</td>
                  <td>
                    <span className={`badge ${zone.isActive ? 'badge-success' : 'badge-gray'}`}>
                      {zone.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(zone)}>Edit</button>
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
