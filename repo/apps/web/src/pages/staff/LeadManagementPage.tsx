import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiGet, apiPost, apiPut, getCsrfToken, fetchCsrfToken } from '../../utils/api';

interface Lead {
  _id: string;
  type: string;
  requirements: string;
  budgetCapCents?: number;
  quoteAmountCents?: number;
  closeReason?: string;
  status: string;
  contactPhone?: string;
  requesterUserId: { _id: string; displayName: string } | string;
  availabilityWindows: { start: string; end: string }[];
  lastActivityAt?: string;
  notes?: string;
  version?: number;
  createdAt: string;
  updatedAt?: string;
}

interface LeadNote {
  _id: string;
  content: string;
  authorUserId: string;
  createdAt: string;
}

interface LeadAttachment {
  _id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface LeadHistory {
  _id: string;
  fromStatus: string;
  toStatus: string;
  note?: string;
  changedByUserId?: string;
  quoteAmountCents?: number;
  closeReason?: string;
  createdAt: string;
  changedAt: string;
}

const ALL_STATUSES = ['New', 'In Discussion', 'Quoted', 'Confirmed', 'Closed'];

const VALID_TRANSITIONS: Record<string, string[]> = {
  'New': ['In Discussion', 'Closed'],
  'In Discussion': ['Quoted', 'Closed'],
  'Quoted': ['In Discussion', 'Confirmed', 'Closed'],
  'Confirmed': ['Closed'],
  'Closed': [],
};

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

function authorName(u: { displayName?: string; _id?: string } | string) {
  return typeof u === 'object' ? (u.displayName || u._id || '') : u;
}

export default function LeadManagementPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const [filterStatus, setFilterStatus] = useState('');
  const [view, setView] = useState<'table' | 'kanban'>('table');

  const [selected, setSelected] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [history, setHistory] = useState<LeadHistory[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [newNote, setNewNote] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [quoteAmountCents, setQuoteAmountCents] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (filterStatus) params.status = filterStatus;
    const res = await apiGet<Lead[]>('/leads', params);
    if (res.ok && res.data) {
      setLeads(res.data);
      setTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setError(res.error?.message || 'Failed to load leads');
    }
    setLoading(false);
  }, [page, filterStatus]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function openDetail(lead: Lead) {
    setSelected(lead);
    setNotes([]);
    setAttachments([]);
    setHistory([]);
    setNewNote('');
    setQuoteAmountCents('');
    setCloseReason('');
    setDetailLoading(true);
    const [notesRes, attRes, histRes] = await Promise.all([
      apiGet<LeadNote[]>(`/leads/${lead._id}/notes`),
      apiGet<LeadAttachment[]>(`/leads/${lead._id}/attachments`),
      apiGet<LeadHistory[]>(`/leads/${lead._id}/history`),
    ]);
    if (notesRes.ok && notesRes.data) setNotes(notesRes.data);
    if (attRes.ok && attRes.data) setAttachments(attRes.data);
    if (histRes.ok && histRes.data) setHistory(histRes.data);
    setDetailLoading(false);
  }

  async function handleAddNote() {
    if (!selected || !newNote.trim()) return;
    setNoteSubmitting(true);
    const res = await apiPost(`/leads/${selected._id}/notes`, { content: newNote });
    if (res.ok) {
      setNewNote('');
      const notesRes = await apiGet<LeadNote[]>(`/leads/${selected._id}/notes`);
      if (notesRes.ok && notesRes.data) setNotes(notesRes.data);
    }
    setNoteSubmitting(false);
  }

  async function handleTransition(toStatus: string) {
    if (!selected) return;
    setTransitioning(toStatus);
    const body: Record<string, unknown> = { status: toStatus };
    if (toStatus === 'Quoted' && quoteAmountCents) {
      body.quoteAmountCents = Math.round(Number(quoteAmountCents) * 100);
    }
    if (toStatus === 'Closed' && closeReason) {
      body.closeReason = closeReason;
    }
    const res = await apiPut(`/leads/${selected._id}/status`, body);
    if (res.ok) {
      setSuccess(`Status updated to ${STATUS_LABEL[toStatus] || toStatus}.`);
      setSelected((prev) => prev ? { ...prev, status: toStatus } : null);
      setLeads((prev) => prev.map((l) => l._id === selected._id ? { ...l, status: toStatus } : l));
      setQuoteAmountCents('');
      setCloseReason('');
      const histRes = await apiGet<LeadHistory[]>(`/leads/${selected._id}/history`);
      if (histRes.ok && histRes.data) setHistory(histRes.data);
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Status change failed');
    }
    setTransitioning(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setUploadFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  }

  async function handleUploadAttachments() {
    if (!selected || uploadFiles.length === 0) return;
    setUploading(true);
    let uploadedCount = 0;
    let csrf = getCsrfToken();
    if (!csrf) csrf = await fetchCsrfToken();
    for (const file of uploadFiles) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch(`/api/v1/leads/${selected._id}/attachments`, {
          method: 'POST',
          headers: { 'x-csrf-token': csrf || '' },
          body: fd,
          credentials: 'include',
        });
        if (res.ok) uploadedCount++;
      } catch {
        // non-fatal
      }
    }
    setUploadFiles([]);
    if (uploadedCount > 0) {
      setSuccess(`${uploadedCount} file${uploadedCount !== 1 ? 's' : ''} uploaded.`);
      const attRes = await apiGet<LeadAttachment[]>(`/leads/${selected._id}/attachments`);
      if (attRes.ok && attRes.data) setAttachments(attRes.data);
      setTimeout(() => setSuccess(''), 3000);
    }
    setUploading(false);
  }

  const totalPages = Math.ceil(total / pageSize);

  // Kanban grouped
  const kanbanCols = ALL_STATUSES.map((s) => ({
    status: s,
    leads: leads.filter((l) => l.status === s),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Lead Management</h1>
        <div className="flex gap-2">
          <button className={`btn btn-sm ${view === 'table' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('table')}>Table</button>
          <button className={`btn btn-sm ${view === 'kanban' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('kanban')}>Kanban</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {view === 'table' && (
        <div className="card mb-4" style={{ padding: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0, maxWidth: '200px' }}>
            <label>Filter by Status</label>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="empty-state">
          <h3>No leads found</h3>
          <p>No lead requests match the current filters.</p>
        </div>
      ) : view === 'table' ? (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
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
                      <td>{authorName(lead.requesterUserId)}</td>
                      <td><span className="badge badge-gray">{TYPE_LABEL[lead.type] || lead.type}</span></td>
                      <td style={{ maxWidth: '200px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.requirements}>
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
                        <button className="btn btn-secondary btn-sm" onClick={() => openDetail(lead)}>Open</button>
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
      ) : (
        /* Kanban View */
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ALL_STATUSES.length}, minmax(180px, 1fr))`, gap: '1rem', overflowX: 'auto' }}>
          {kanbanCols.map((col) => (
            <div key={col.status}>
              <div style={{ fontWeight: 700, marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`badge ${STATUS_BADGE[col.status] || 'badge-gray'}`}>{STATUS_LABEL[col.status]}</span>
                <span className="text-sm text-gray">{col.leads.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '100px' }}>
                {col.leads.map((lead) => (
                  <div
                    key={lead._id}
                    className="card"
                    style={{ cursor: 'pointer', padding: '0.75rem' }}
                    onClick={() => openDetail(lead)}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      {authorName(lead.requesterUserId)}
                    </div>
                    <div className="text-sm text-gray" style={{ marginBottom: '0.25rem' }}>
                      {TYPE_LABEL[lead.type] || lead.type}
                    </div>
                    <div className="text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lead.requirements}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Panel Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Lead — {authorName(selected.requesterUserId)}</h2>

            {detailLoading ? (
              <div className="loading"><div className="spinner" />Loading...</div>
            ) : (
              <>
                <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '1rem' }}>
                  <div><strong>Type:</strong> {TYPE_LABEL[selected.type] || selected.type}</div>
                  <div>
                    <strong>Status:</strong>{' '}
                    <span className={`badge ${STATUS_BADGE[selected.status] || 'badge-gray'}`}>
                      {STATUS_LABEL[selected.status] || selected.status}
                    </span>
                  </div>
                  <div><strong>Requirements:</strong> {selected.requirements}</div>
                  {selected.budgetCapCents != null && <div><strong>Budget Cap:</strong> ${(selected.budgetCapCents / 100).toFixed(2)}</div>}
                  {selected.quoteAmountCents != null && <div><strong>Quote:</strong> ${(selected.quoteAmountCents / 100).toFixed(2)}</div>}
                  {selected.closeReason && <div><strong>Close Reason:</strong> {selected.closeReason}</div>}
                  {selected.contactPhone && <div><strong>Phone:</strong> {selected.contactPhone}</div>}
                  {selected.lastActivityAt && <div><strong>Last Activity:</strong> {fmtDt(selected.lastActivityAt)}</div>}
                  <div><strong>Submitted:</strong> {fmt(selected.createdAt)}</div>
                  {selected.version != null && <div><strong>Version:</strong> {selected.version}</div>}
                </div>

                {/* Status transitions */}
                {VALID_TRANSITIONS[selected.status]?.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>Change Status</p>
                    {VALID_TRANSITIONS[selected.status].includes('Quoted') && (
                      <div className="form-group">
                        <label>Quote Amount ($) — required when transitioning to Quoted</label>
                        <input
                          type="number"
                          min="0"
                          value={quoteAmountCents}
                          onChange={(e) => setQuoteAmountCents(e.target.value)}
                          placeholder="e.g. 250.00"
                        />
                      </div>
                    )}
                    {VALID_TRANSITIONS[selected.status].includes('Closed') && (
                      <div className="form-group">
                        <label>Close Reason — required when transitioning to Closed</label>
                        <input
                          type="text"
                          value={closeReason}
                          onChange={(e) => setCloseReason(e.target.value)}
                          placeholder="Reason for closing..."
                        />
                      </div>
                    )}
                    <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                      {VALID_TRANSITIONS[selected.status].map((s) => (
                        <button
                          key={s}
                          className="btn btn-primary btn-sm"
                          disabled={transitioning === s}
                          onClick={() => handleTransition(s)}
                        >
                          {transitioning === s ? '...' : `→ ${STATUS_LABEL[s]}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* History */}
                {history.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>Status History</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {history.map((h) => (
                        <div key={h._id} className="text-sm" style={{ padding: '0.35rem 0.5rem', background: 'var(--gray-50)', borderRadius: 'var(--radius)' }}>
                          <span className="badge badge-gray" style={{ marginRight: '0.4rem' }}>
                            {STATUS_LABEL[h.fromStatus] || h.fromStatus} → {STATUS_LABEL[h.toStatus] || h.toStatus}
                          </span>
                          {h.note && <span>{h.note} · </span>}
                          <span className="text-gray">{fmtDt(h.changedAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>Internal Notes</p>
                  {notes.length === 0 ? (
                    <p className="text-sm text-gray">No notes yet.</p>
                  ) : (
                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.5rem' }}>
                      {notes.map((n) => (
                        <div key={n._id} style={{ padding: '0.4rem 0.6rem', background: 'var(--gray-50)', borderRadius: 'var(--radius)' }}>
                          <p className="text-sm">{n.content}</p>
                          <p className="text-sm text-gray">{n.authorUserId} · {fmtDt(n.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add a note..."
                      style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid var(--gray-300)', borderRadius: 'var(--radius)', fontSize: '0.85rem' }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                    />
                    <button className="btn btn-primary btn-sm" disabled={noteSubmitting || !newNote.trim()} onClick={handleAddNote}>
                      {noteSubmitting ? '...' : 'Add'}
                    </button>
                  </div>
                </div>

                {/* Attachments */}
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>Attachments</p>
                  {attachments.length === 0 ? (
                    <p className="text-sm text-gray">No attachments.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', marginBottom: '0.5rem' }}>
                      {attachments.map((a) => (
                        <li key={a._id} className="text-sm" style={{ padding: '0.25rem 0' }}>
                          <a
                            href={`/api/v1/leads/${selected!._id}/attachments/${a._id}/download`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {a.originalName}
                          </a>
                          <span className="text-gray"> · {fmt(a.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    style={{
                      border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--gray-300)'}`,
                      borderRadius: 'var(--radius)',
                      padding: '0.75rem',
                      textAlign: 'center',
                      background: dragging ? 'var(--primary-light)' : 'var(--gray-50)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {uploadFiles.length === 0 ? (
                      <span className="text-gray">Drop files to attach, or{' '}
                        <label style={{ color: 'var(--primary)', cursor: 'pointer' }}>
                          browse
                          <input type="file" multiple style={{ display: 'none' }} onChange={(e) => {
                            if (e.target.files) setUploadFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                          }} />
                        </label>
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span>{uploadFiles.length} file{uploadFiles.length !== 1 ? 's' : ''} selected</span>
                        <div className="flex gap-2">
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={uploading}
                            onClick={handleUploadAttachments}
                          >
                            {uploading ? 'Uploading...' : 'Upload'}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setUploadFiles([])}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
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
