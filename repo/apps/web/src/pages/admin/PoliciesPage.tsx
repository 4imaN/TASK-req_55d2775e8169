import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../../utils/api';

interface PolicyVersion {
  _id: string;
  policyArea: string;
  settings: Record<string, unknown>;
  effectiveAt: string;
  createdAt: string;
}

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupByArea(versions: PolicyVersion[]): Record<string, PolicyVersion[]> {
  const groups: Record<string, PolicyVersion[]> = {};
  versions.forEach((v) => {
    if (!groups[v.policyArea]) groups[v.policyArea] = [];
    groups[v.policyArea].push(v);
  });
  // Sort each group by effectiveAt desc
  Object.values(groups).forEach((arr) => arr.sort((a, b) => new Date(b.effectiveAt || b.createdAt).getTime() - new Date(a.effectiveAt || a.createdAt).getTime()));
  return groups;
}

export default function PoliciesPage() {
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [formArea, setFormArea] = useState('');
  const [formSettings, setFormSettings] = useState('{}');
  const [formEffectiveFrom, setFormEffectiveFrom] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [expandedArea, setExpandedArea] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<PolicyVersion[]>('/policies', { pageSize: '200' });
    if (res.ok && res.data) {
      setVersions(res.data);
    } else {
      setError(res.error?.message || 'Failed to load policies');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  async function handleCreate() {
    if (!formArea.trim()) { setFormError('Policy area is required.'); return; }
    if (!formEffectiveFrom) { setFormError('Effective At is required.'); return; }
    let parsed: unknown;
    try {
      parsed = JSON.parse(formSettings);
    } catch {
      setFormError('Settings must be valid JSON.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    const body: Record<string, unknown> = {
      policyArea: formArea.trim(),
      settings: parsed,
      effectiveAt: new Date(formEffectiveFrom).toISOString(),
    };
    const res = await apiPost('/policies', body);
    if (res.ok) {
      setSuccess('Policy version created.');
      setShowForm(false);
      setFormArea('');
      setFormSettings('{}');
      setFormEffectiveFrom('');
      fetchPolicies();
      setTimeout(() => setSuccess(''), 4000);
    } else {
      setFormError(res.error?.message || 'Failed to create policy');
    }
    setSubmitting(false);
  }

  const grouped = groupByArea(versions);
  const areas = Object.keys(grouped).sort();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Policy Management</h1>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormError(''); }}>
          + New Version
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading policies...</div>
      ) : areas.length === 0 ? (
        <div className="empty-state">
          <h3>No policies configured</h3>
          <p>Create the first policy version to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {areas.map((area) => {
            const areaVersions = grouped[area];
            const current = areaVersions[0];
            const isExpanded = expandedArea === area;
            return (
              <div key={area} className="card" style={{ padding: 0 }}>
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onClick={() => setExpandedArea(isExpanded ? null : area)}
                >
                  <div>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize', marginBottom: '0.2rem' }}>
                      {area.replace(/_/g, ' ')}
                    </div>
                    <div className="text-sm text-gray">
                      Effective {fmt(current.effectiveAt || current.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge badge-success">Active</span>
                    <span style={{ color: 'var(--gray-400)', fontSize: '0.9rem' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--gray-200)', padding: '1rem 1.25rem' }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Current Settings</p>
                    <pre
                      style={{
                        background: 'var(--gray-50)',
                        border: '1px solid var(--gray-200)',
                        borderRadius: 'var(--radius)',
                        padding: '0.75rem',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        marginBottom: '1rem',
                      }}
                    >
                      {JSON.stringify(current.settings, null, 2)}
                    </pre>

                    {areaVersions.length > 1 && (
                      <>
                        <p style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Policy History</p>
                        <div className="table-wrapper">
                          <table>
                            <thead>
                              <tr>
                                <th>Effective At</th>
                                <th>Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {areaVersions.map((v) => (
                                <tr key={v._id}>
                                  <td>{fmt(v.effectiveAt || v.createdAt)}</td>
                                  <td>{fmt(v.createdAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Version Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Create New Policy Version</h2>
            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-group">
              <label>Policy Area</label>
              <input
                type="text"
                value={formArea}
                onChange={(e) => setFormArea(e.target.value)}
                placeholder="e.g. booking, cancellation, capacity"
                list="area-suggestions"
              />
              <datalist id="area-suggestions">
                {areas.map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>

            <div className="form-group">
              <label>Effective At — required</label>
              <input
                type="datetime-local"
                value={formEffectiveFrom}
                onChange={(e) => setFormEffectiveFrom(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Settings (JSON)</label>
              <textarea
                rows={10}
                value={formSettings}
                onChange={(e) => setFormSettings(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                spellCheck={false}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={submitting} onClick={handleCreate}>
                {submitting ? 'Creating...' : 'Create Version'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
