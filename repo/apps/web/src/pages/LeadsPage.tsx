import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiGet, api, getCsrfToken, fetchCsrfToken } from '../utils/api';

interface AvailabilityWindow {
  start: string;
  end: string;
}

interface Lead {
  _id: string;
  type: 'group_study' | 'long_term';
  requirements: string;
  budgetCapCents?: number;
  availabilityWindows: AvailabilityWindow[];
  contactPhone?: string;
  status: 'New' | 'In Discussion' | 'Quoted' | 'Confirmed' | 'Closed';
  createdAt: string;
}

interface LeadHistory {
  _id: string;
  fromStatus: string;
  toStatus: string;
  note?: string;
  closeReason?: string;
  changedByUserId?: string;
  createdAt: string;
  changedAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  'New': 'badge-primary',
  'In Discussion': 'badge-warning',
  'Quoted': 'badge-primary',
  'Confirmed': 'badge-success',
  'Closed': 'badge-gray',
};

const STATUS_LABEL: Record<string, string> = {
  'New': 'New',
  'In Discussion': 'In Discussion',
  'Quoted': 'Quoted',
  'Confirmed': 'Confirmed',
  'Closed': 'Closed',
};

const TYPE_LABEL: Record<string, string> = {
  group_study: 'Group Study',
  long_term: 'Long Term',
};

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDt(dt: string) {
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const emptyWindow = (): AvailabilityWindow => ({ start: '', end: '' });

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Form fields
  const [fType, setFType] = useState<'group_study' | 'long_term'>('group_study');
  const [fReqs, setFReqs] = useState('');
  const [fBudget, setFBudget] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fWindows, setFWindows] = useState<AvailabilityWindow[]>([emptyWindow()]);

  // Detail view
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<LeadHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Drag-and-drop attachment
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<Lead[]>('/leads', { page: String(page), pageSize: String(pageSize) });
    if (res.ok && res.data) {
      setLeads(res.data);
      setTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setError(res.error?.message || 'Failed to load requests');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function fetchHistory(leadId: string) {
    setHistoryLoading(true);
    const res = await apiGet<LeadHistory[]>(`/leads/${leadId}/history`);
    if (res.ok && res.data) setHistory(res.data);
    setHistoryLoading(false);
  }

  function openDetail(lead: Lead) {
    setSelectedLead(lead);
    setHistory([]);
    fetchHistory(lead._id);
  }

  function resetForm() {
    setFType('group_study');
    setFReqs('');
    setFBudget('');
    setFPhone('');
    setFWindows([emptyWindow()]);
    setFiles([]);
    setFormError('');
  }

  async function handleSubmit() {
    if (!fReqs.trim()) { setFormError('Requirements are required.'); return; }
    if (!fBudget || Number(fBudget) <= 0) { setFormError('Budget Cap must be greater than 0.'); return; }
    if (!fPhone.trim()) { setFormError('Contact Phone is required.'); return; }
    if (!/^\+?[\d\s\-().]{7,}$/.test(fPhone.trim())) { setFormError('Contact Phone must be a valid phone number.'); return; }
    if (fWindows.some((w) => !w.start || !w.end)) { setFormError('Fill in all availability windows.'); return; }
    setSubmitting(true);
    setFormError('');
    const idempotencyKey = Date.now() + '-' + Math.random().toString(36).slice(2);
    const body: Record<string, unknown> = {
      type: fType,
      requirements: fReqs,
      availabilityWindows: fWindows,
      budgetCapCents: Math.round(Number(fBudget) * 100),
      contactPhone: fPhone.trim(),
    };

    const res = await api('/leads', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': idempotencyKey },
    });
    if (res.ok) {
      const leadId = (res.data as { _id?: string })?._id;
      setShowForm(false);
      // Upload files if any were selected
      if (leadId && files.length > 0) {
        let csrf = getCsrfToken();
        if (!csrf) csrf = await fetchCsrfToken();
        let uploaded = 0;
        let failed = 0;
        for (const file of files) {
          const fd = new FormData();
          fd.append('file', file);
          try {
            const uploadRes = await fetch(`/api/v1/leads/${leadId}/attachments`, {
              method: 'POST',
              headers: { 'x-csrf-token': csrf || '' },
              body: fd,
              credentials: 'include',
            });
            if (uploadRes.ok) {
              uploaded++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }
        if (failed > 0 && uploaded > 0) {
          setSuccess(`Request submitted. ${uploaded} of ${files.length} attachment(s) uploaded; ${failed} failed.`);
        } else if (failed > 0) {
          setError(`Request submitted, but all ${failed} attachment(s) failed to upload.`);
        } else {
          setSuccess('Request submitted successfully.');
        }
      } else {
        setSuccess('Request submitted successfully.');
      }
      resetForm();
      fetchLeads();
      setTimeout(() => { setSuccess(''); setError(''); }, 4000);
    } else {
      setFormError(res.error?.message || 'Failed to submit request');
    }
    setSubmitting(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }

  function addWindow() { setFWindows((prev) => [...prev, emptyWindow()]); }
  function removeWindow(i: number) { setFWindows((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateWindow(i: number, field: 'start' | 'end', val: string) {
    setFWindows((prev) => prev.map((w, idx) => idx === i ? { ...w, [field]: val } : w));
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Lead Requests</h1>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); resetForm(); }}>
          + New Request
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading requests...</div>
      ) : leads.length === 0 ? (
        <div className="empty-state">
          <h3>No requests yet</h3>
          <p>Submit a request for group study or long-term bookings.</p>
          <button className="btn btn-primary mt-4" onClick={() => { setShowForm(true); resetForm(); }}>
            New Request
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Requirements</th>
                    <th>Budget</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead._id}>
                      <td><span className="badge badge-primary">{TYPE_LABEL[lead.type] || lead.type}</span></td>
                      <td style={{ maxWidth: '200px' }}>
                        <span title={lead.requirements} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {lead.requirements}
                        </span>
                      </td>
                      <td>{lead.budgetCapCents != null ? `$${(lead.budgetCapCents / 100).toFixed(2)}` : '—'}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[lead.status] || 'badge-gray'}`}>
                          {STATUS_LABEL[lead.status] || lead.status}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(lead.createdAt)}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openDetail(lead)}>
                          View
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

      {/* New Request Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <h2>New Lead Request</h2>

            {formError && <div className="alert alert-error">{formError}</div>}

            <div className="form-group">
              <label>Request Type</label>
              <select value={fType} onChange={(e) => setFType(e.target.value as 'group_study' | 'long_term')}>
                <option value="group_study">Group Study</option>
                <option value="long_term">Long Term</option>
              </select>
            </div>

            <div className="form-group">
              <label>Requirements</label>
              <textarea
                rows={4}
                value={fReqs}
                onChange={(e) => setFReqs(e.target.value)}
                placeholder="Describe your needs, group size, special requirements..."
              />
            </div>

            <div className="form-group">
              <label>Budget Cap ($)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={fBudget}
                onChange={(e) => setFBudget(e.target.value)}
                placeholder="e.g. 500"
              />
            </div>

            <div className="form-group">
              <label>Contact Phone</label>
              <input
                type="tel"
                required
                value={fPhone}
                onChange={(e) => setFPhone(e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between mb-2">
                <label style={{ marginBottom: 0 }}>Availability Windows</label>
                <button className="btn btn-secondary btn-sm" onClick={addWindow}>+ Add</button>
              </div>
              {fWindows.map((w, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <input
                    type="datetime-local"
                    value={w.start}
                    onChange={(e) => updateWindow(i, 'start', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span className="text-sm text-gray">to</span>
                  <input
                    type="datetime-local"
                    value={w.end}
                    onChange={(e) => updateWindow(i, 'end', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  {fWindows.length > 1 && (
                    <button className="btn btn-danger btn-sm" onClick={() => removeWindow(i)}>×</button>
                  )}
                </div>
              ))}
            </div>

            <div className="form-group">
              <label>Attachments — optional</label>
              <div
                ref={dropRef}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--gray-300)'}`,
                  borderRadius: 'var(--radius)',
                  padding: '1.5rem',
                  textAlign: 'center',
                  background: dragging ? 'var(--primary-light)' : 'var(--gray-50)',
                  transition: 'all 0.15s',
                }}
              >
                {files.length === 0 ? (
                  <span className="text-gray text-sm">Drag and drop files here, or{' '}
                    <label style={{ color: 'var(--primary)', cursor: 'pointer' }}>
                      browse
                      <input type="file" multiple style={{ display: 'none' }} onChange={(e) => {
                        if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                      }} />
                    </label>
                  </span>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, textAlign: 'left' }}>
                    {files.map((f, i) => (
                      <li key={i} className="text-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0' }}>
                        <span>{f.name}</span>
                        <button className="btn btn-danger btn-sm" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>×</button>
                      </li>
                    ))}
                    <li style={{ marginTop: '0.5rem' }}>
                      <label style={{ color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem' }}>
                        + Add more
                        <input type="file" multiple style={{ display: 'none' }} onChange={(e) => {
                          if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                        }} />
                      </label>
                    </li>
                  </ul>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={submitting} onClick={handleSubmit}>
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedLead && (
        <div className="modal-overlay" onClick={() => setSelectedLead(null)}>
          <div className="modal" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Request Details</h2>
            <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <div><strong>Type:</strong> {TYPE_LABEL[selectedLead.type] || selectedLead.type}</div>
              <div>
                <strong>Status:</strong>{' '}
                <span className={`badge ${STATUS_BADGE[selectedLead.status] || 'badge-gray'}`}>
                  {STATUS_LABEL[selectedLead.status] || selectedLead.status}
                </span>
              </div>
              <div><strong>Requirements:</strong> {selectedLead.requirements}</div>
              {selectedLead.budgetCapCents != null && <div><strong>Budget:</strong> ${(selectedLead.budgetCapCents / 100).toFixed(2)}</div>}
              {selectedLead.contactPhone && <div><strong>Phone:</strong> {selectedLead.contactPhone}</div>}
              <div><strong>Submitted:</strong> {fmt(selectedLead.createdAt)}</div>
              {selectedLead.availabilityWindows.length > 0 && (
                <div>
                  <strong>Availability:</strong>
                  <ul style={{ marginLeft: '1rem', marginTop: '0.25rem' }}>
                    {selectedLead.availabilityWindows.map((w, i) => (
                      <li key={i} className="text-sm text-gray">
                        {fmtDt(w.start)} — {fmtDt(w.end)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--gray-700)' }}>Status Timeline</h3>
            {historyLoading ? (
              <div className="loading"><div className="spinner" />Loading history...</div>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray">No status changes recorded.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                {history.map((h) => (
                  <div key={h._id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.5rem', background: 'var(--gray-50)', borderRadius: 'var(--radius)' }}>
                    <span className="badge badge-gray" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {h.fromStatus} → {h.toStatus}
                    </span>
                    <div>
                      {h.note && <p className="text-sm">{h.note}</p>}
                      <p className="text-sm text-gray">{fmtDt(h.changedAt || h.createdAt)}{h.changedByUserId ? ` by ${h.changedByUserId}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedLead(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
