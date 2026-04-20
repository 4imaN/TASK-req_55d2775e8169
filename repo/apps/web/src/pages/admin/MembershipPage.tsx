import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from '../../utils/api';

interface Tier {
  _id: string;
  name: string;
  description?: string;
  benefits: Record<string, unknown>;
  version: number;
  createdAt: string;
}

interface Member {
  _id: string;
  userId: string;
  username: string;
  displayName: string;
  tierId?: string | null;
  tierName?: string | null;
  balanceCents: number;
  pointsBalance: number;
  isBlacklisted?: boolean;
  createdAt: string;
}

function personName(m: Member) {
  return m.displayName || m.username || m.userId;
}

function memberTierName(m: Member) {
  return m.tierName || '—';
}

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MembershipPage() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tiersError, setTiersError] = useState('');

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Tier form
  const [showTierForm, setShowTierForm] = useState(false);
  const [editingTier, setEditingTier] = useState<Tier | null>(null);
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fBenefits, setFBenefits] = useState('{}');
  const [fError, setFError] = useState('');
  const [fSubmitting, setFSubmitting] = useState(false);

  // Assign tier
  const [assigningMember, setAssigningMember] = useState<Member | null>(null);
  const [assignTierId, setAssignTierId] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  const pageSize = 20;

  const fetchTiers = useCallback(async () => {
    setTiersLoading(true);
    const res = await apiGet<Tier[]>('/membership/tiers');
    if (res.ok && res.data) setTiers(res.data);
    else setTiersError(res.error?.message || 'Failed to load tiers');
    setTiersLoading(false);
  }, []);

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    const params: Record<string, string> = { page: String(memberPage), pageSize: String(pageSize) };
    if (memberSearch) params.search = memberSearch;
    const res = await apiGet<Member[]>('/membership/members', params);
    if (res.ok && res.data) {
      setMembers(res.data);
      setMemberTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setMembersError(res.error?.message || 'Failed to load members');
    }
    setMembersLoading(false);
  }, [memberPage, memberSearch]);

  useEffect(() => { fetchTiers(); }, [fetchTiers]);
  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  function openTierForm(tier?: Tier) {
    setEditingTier(tier || null);
    setFName(tier?.name || '');
    setFDesc(tier?.description || '');
    setFBenefits(tier ? JSON.stringify(tier.benefits, null, 2) : '{}');
    setFError('');
    setShowTierForm(true);
  }

  async function handleTierSubmit() {
    if (!fName.trim()) { setFError('Name is required.'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(fBenefits); } catch { setFError('Benefits must be valid JSON.'); return; }
    setFSubmitting(true);
    setFError('');
    const body = editingTier
      ? { name: fName.trim(), description: fDesc, benefits: parsed, version: editingTier.version }
      : { name: fName.trim(), description: fDesc, benefits: parsed };
    const res = editingTier
      ? await apiPut(`/membership/tiers/${editingTier._id}`, body)
      : await apiPost('/membership/tiers', body);
    if (res.ok) {
      setSuccess(editingTier ? 'Tier updated.' : 'Tier created.');
      setShowTierForm(false);
      fetchTiers();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setFError(res.error?.message || 'Failed to save tier');
    }
    setFSubmitting(false);
  }

  async function handleAssignTier() {
    if (!assigningMember) return;
    setAssignLoading(true);
    const userId = typeof assigningMember.userId === 'object' ? assigningMember.userId._id : assigningMember.userId;
    const res = await apiPut('/membership/assign', { userId, tierId: assignTierId || null });
    if (res.ok) {
      setSuccess('Tier assigned.');
      setAssigningMember(null);
      fetchMembers();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Failed to assign tier');
    }
    setAssignLoading(false);
  }

  const memberPages = Math.ceil(memberTotal / pageSize);

  return (
    <div>
      <h1>Membership Management</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Tiers Section */}
      <div className="flex items-center justify-between mb-2" style={{ marginTop: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Membership Tiers</h2>
        <button className="btn btn-primary btn-sm" onClick={() => openTierForm()}>+ New Tier</button>
      </div>

      {tiersLoading ? (
        <div className="loading"><div className="spinner" />Loading tiers...</div>
      ) : tiersError ? (
        <div className="alert alert-error">{tiersError}</div>
      ) : tiers.length === 0 ? (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <p>No tiers configured.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {tiers.map((tier) => (
            <div key={tier._id} className="card" style={{ padding: '0.85rem' }}>
              <div className="flex items-center justify-between mb-1">
                <strong>{tier.name}</strong>
                <button className="btn btn-secondary btn-sm" onClick={() => openTierForm(tier)}>Edit</button>
              </div>
              {tier.description && <p className="text-sm text-gray" style={{ marginBottom: '0.5rem' }}>{tier.description}</p>}
              <pre style={{ fontSize: '0.75rem', background: 'var(--gray-50)', padding: '0.4rem', borderRadius: '4px', overflowX: 'auto' }}>
                {JSON.stringify(tier.benefits, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* Members Section */}
      <div className="flex items-center justify-between mb-2">
        <h2 style={{ fontSize: '1.1rem' }}>Member Accounts</h2>
        <span className="text-sm text-gray">{memberTotal} total</span>
      </div>

      <div className="card mb-4" style={{ padding: '0.75rem 1rem' }}>
        <div className="form-group" style={{ marginBottom: 0, maxWidth: '300px' }}>
          <label>Search</label>
          <input
            type="text"
            value={memberSearch}
            onChange={(e) => { setMemberSearch(e.target.value); setMemberPage(1); }}
            placeholder="Username or display name..."
          />
        </div>
      </div>

      {membersLoading ? (
        <div className="loading"><div className="spinner" />Loading members...</div>
      ) : membersError ? (
        <div className="alert alert-error">{membersError}</div>
      ) : members.length === 0 ? (
        <div className="empty-state">
          <h3>No members found</h3>
          <p>{memberSearch ? 'No results for that search.' : 'No members yet.'}</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Tier</th>
                    <th>Balance</th>
                    <th>Points</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m._id}>
                      <td>{personName(m)}</td>
                      <td>{memberTierName(m)}</td>
                      <td>${(m.balanceCents / 100).toFixed(2)}</td>
                      <td>{m.pointsBalance}</td>
                      <td>
                        {m.isBlacklisted ? (
                          <span className="badge badge-danger">Blacklisted</span>
                        ) : (
                          <span className="badge badge-success">Active</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setAssigningMember(m);
                            setAssignTierId(m.tierId || '');
                          }}
                        >
                          Assign Tier
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {memberPages > 1 && (
            <div className="pagination">
              <button className="btn btn-secondary btn-sm" disabled={memberPage <= 1} onClick={() => setMemberPage(memberPage - 1)}>Prev</button>
              <span className="text-sm text-gray">Page {memberPage} of {memberPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={memberPage >= memberPages} onClick={() => setMemberPage(memberPage + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* Tier Form Modal */}
      {showTierForm && (
        <div className="modal-overlay" onClick={() => setShowTierForm(false)}>
          <div className="modal" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <h2>{editingTier ? 'Edit Tier' : 'New Tier'}</h2>
            {fError && <div className="alert alert-error">{fError}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Tier name..." />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea rows={2} value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Optional description..." />
            </div>
            <div className="form-group">
              <label>Benefits (JSON)</label>
              <textarea
                rows={8}
                value={fBenefits}
                onChange={(e) => setFBenefits(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                spellCheck={false}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowTierForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={fSubmitting} onClick={handleTierSubmit}>
                {fSubmitting ? 'Saving...' : editingTier ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Tier Modal */}
      {assigningMember && (
        <div className="modal-overlay" onClick={() => setAssigningMember(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Assign Tier — {personName(assigningMember)}</h2>
            <div className="form-group">
              <label>Select Tier</label>
              <select value={assignTierId} onChange={(e) => setAssignTierId(e.target.value)}>
                <option value="">No Tier</option>
                {tiers.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setAssigningMember(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={assignLoading} onClick={handleAssignTier}>
                {assignLoading ? 'Saving...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
