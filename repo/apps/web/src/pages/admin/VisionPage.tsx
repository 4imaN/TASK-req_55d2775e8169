import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiGet, apiPost, apiPut, getCsrfToken, fetchCsrfToken } from '../../utils/api';

interface Camera {
  camera_id: string;
  _id?: string;
  name: string;
  location?: string;
  device_identifier?: string;
  is_active?: boolean;
  isActive?: boolean;
  registered_at?: string;
  createdAt?: string;
}

interface FaceEvent {
  _id: string;
  camera_id?: string;
  cameraId?: { _id: string; name: string } | string;
  matched_user_id?: string;
  userId?: { _id: string; displayName: string } | string;
  decision: 'allowlist_match' | 'blocklist_match' | 'no_match' | 'ambiguous_match';
  confidence_score?: number;
  confidence?: number;
  occurred_at?: string;
  timestamp?: string;
}

interface EnrollmentRecord {
  enrollment_id: string;
  user_id: string;
  sample_count: number;
  status: string;
  enrolled_at: string | null;
  consent_given: boolean;
}

const DECISION_BADGE: Record<string, string> = {
  allowlist_match: 'badge-success',
  blocklist_match: 'badge-danger',
  no_match: 'badge-gray',
  ambiguous_match: 'badge-warning',
};

const DECISION_LABEL: Record<string, string> = {
  allowlist_match: 'Allowlist Match',
  blocklist_match: 'Blocklist Match',
  no_match: 'No Match',
  ambiguous_match: 'Ambiguous',
};

function cameraName(c: { _id: string; name: string } | string) {
  return typeof c === 'object' ? c.name : c;
}

function personName(u: { _id: string; displayName: string } | string | undefined) {
  if (!u) return '—';
  return typeof u === 'object' ? u.displayName : u;
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function VisionPage() {
  const [tab, setTab] = useState<'cameras' | 'events' | 'enrollments'>('cameras');

  // Cameras
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [camerasLoading, setCamerasLoading] = useState(false);
  const [camerasError, setCamerasError] = useState('');

  // Camera form
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);
  const [fName, setFName] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fDeviceId, setFDeviceId] = useState('');
  const [fSubmitting, setFSubmitting] = useState(false);
  const [fError, setFError] = useState('');

  // Events
  const [events, setEvents] = useState<FaceEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [filterCamera, setFilterCamera] = useState('');
  const [filterDecision, setFilterDecision] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Enrollments
  const [enrollmentUserId, setEnrollmentUserId] = useState('');
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);

  // Detect test (Cameras tab)
  const [testImage, setTestImage] = useState<File | null>(null);
  const [detectResult, setDetectResult] = useState<{ faces?: number; processing_time_ms?: number; error?: string } | null>(null);
  const [detectLoading, setDetectLoading] = useState(false);
  const detectFileRef = useRef<HTMLInputElement>(null);

  // Enroll user form (Enrollments tab)
  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [enrollFormUserId, setEnrollFormUserId] = useState('');
  const [enrollFormConsent, setEnrollFormConsent] = useState(false);
  const [enrollFormFiles, setEnrollFormFiles] = useState<File[]>([]);
  const [enrollFormError, setEnrollFormError] = useState('');
  const [enrollFormSubmitting, setEnrollFormSubmitting] = useState(false);
  const enrollFileRef = useRef<HTMLInputElement>(null);

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const pageSize = 20;

  const fetchCameras = useCallback(async () => {
    setCamerasLoading(true);
    setCamerasError('');
    const res = await apiGet<Camera[]>('/vision/cameras');
    if (res.ok && res.data) setCameras((res.data as any)?.cameras || res.data || []);
    else setCamerasError(res.error?.message || 'Failed to load cameras');
    setCamerasLoading(false);
  }, []);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError('');
    const params: Record<string, string> = { page: String(eventPage), pageSize: String(pageSize) };
    if (filterCamera) params.camera_id = filterCamera;
    if (filterDecision) params.decision = filterDecision;
    if (filterDateFrom) params.date_from = new Date(filterDateFrom).toISOString();
    if (filterDateTo) params.date_to = new Date(filterDateTo + 'T23:59:59').toISOString();
    const res = await apiGet<FaceEvent[]>('/vision/events', params);
    if (res.ok && res.data) {
      const events = (res.data as any)?.events || res.data || [];
      const total = (res.data as any)?.total ?? (res.meta as { total?: number })?.total ?? events.length;
      setEvents(events);
      setEventTotal(total);
    } else {
      setEventsError(res.error?.message || 'Failed to load events');
    }
    setEventsLoading(false);
  }, [eventPage, filterCamera, filterDecision, filterDateFrom, filterDateTo]);

  const fetchEnrollments = useCallback(async () => {
    if (!enrollmentUserId.trim()) return;
    setEnrollmentsLoading(true);
    const res = await apiGet<{ enrollments: EnrollmentRecord[]; total: number }>(`/vision/enrollments/${enrollmentUserId.trim()}`);
    if (res.ok && res.data) {
      setEnrollments((res.data as any).enrollments || []);
    } else {
      setEnrollments([]);
    }
    setEnrollmentsLoading(false);
  }, [enrollmentUserId]);

  useEffect(() => { if (tab === 'cameras') fetchCameras(); }, [tab, fetchCameras]);
  useEffect(() => { if (tab === 'events') fetchEvents(); }, [tab, fetchEvents]);
  useEffect(() => { if (tab === 'enrollments') fetchEnrollments(); }, [tab, fetchEnrollments]);

  function openCameraForm(cam?: Camera) {
    setEditingCamera(cam || null);
    setFName(cam?.name || '');
    setFLocation(cam?.location || '');
    setFDeviceId(cam?.device_identifier || '');
    setFError('');
    setShowCameraForm(true);
  }

  async function handleCameraSubmit() {
    if (!fName.trim()) { setFError('Name is required.'); return; }
    setFSubmitting(true);
    setFError('');
    const body: Record<string, string> = { name: fName.trim() };
    if (fLocation) body.location = fLocation;
    if (fDeviceId) body.device_identifier = fDeviceId;
    const res = editingCamera
      ? await apiPut(`/vision/cameras/${editingCamera.camera_id || editingCamera._id}`, body)
      : await apiPost('/vision/cameras', body);
    if (res.ok) {
      setSuccess(editingCamera ? 'Camera updated.' : 'Camera registered.');
      setShowCameraForm(false);
      fetchCameras();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setFError(res.error?.message || 'Failed to save camera');
    }
    setFSubmitting(false);
  }

  async function handleTestDetect() {
    if (!testImage) return;
    setDetectLoading(true);
    setDetectResult(null);
    try {
      const fd = new FormData();
      fd.append('frame', testImage);
      let csrf = getCsrfToken();
      if (!csrf) csrf = await fetchCsrfToken();
      const res = await fetch('/api/v1/vision/detect', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: csrf ? { 'x-csrf-token': csrf } : {},
      });
      const data = await res.json();
      setDetectResult(data);
    } catch (err: any) {
      setDetectResult({ error: err.message || 'Request failed' });
    }
    setDetectLoading(false);
  }

  async function handleEnroll() {
    if (!enrollFormUserId.trim()) { setEnrollFormError('User ID is required.'); return; }
    if (!enrollFormConsent) { setEnrollFormError('Consent must be confirmed.'); return; }
    if (enrollFormFiles.length < 3) { setEnrollFormError('Please select at least 3 sample images.'); return; }
    setEnrollFormSubmitting(true);
    setEnrollFormError('');
    try {
      const toBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      const imageSamples = await Promise.all(enrollFormFiles.map(toBase64));
      const res = await apiPost('/vision/enroll', {
        user_id: enrollFormUserId.trim(),
        image_samples: imageSamples,
        consent_metadata: {
          consent_given: true,
          consent_timestamp: new Date().toISOString(),
          consent_actor: enrollFormUserId.trim(),
        },
      });
      if (res.ok) {
        setSuccess('User enrolled successfully.');
        setShowEnrollForm(false);
        setEnrollFormUserId('');
        setEnrollFormConsent(false);
        setEnrollFormFiles([]);
        if (enrollFileRef.current) enrollFileRef.current.value = '';
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setEnrollFormError(res.error?.message || 'Enrollment failed');
      }
    } catch (err: any) {
      setEnrollFormError(err.message || 'Enrollment failed');
    }
    setEnrollFormSubmitting(false);
  }

  const eventPages = Math.ceil(eventTotal / pageSize);

  return (
    <div>
      <h1>Access Oversight (Vision)</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button className={`btn ${tab === 'cameras' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('cameras')}>Cameras</button>
        <button className={`btn ${tab === 'events' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('events')}>Face Events</button>
        <button className={`btn ${tab === 'enrollments' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('enrollments')}>Enrollments</button>
      </div>

      {/* Cameras Tab */}
      {tab === 'cameras' && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontSize: '1rem' }}>Cameras</h2>
            <button className="btn btn-primary btn-sm" onClick={() => openCameraForm()}>+ Register Camera</button>
          </div>

          {camerasLoading ? (
            <div className="loading"><div className="spinner" />Loading cameras...</div>
          ) : camerasError ? (
            <div className="alert alert-error">{camerasError}</div>
          ) : cameras.length === 0 ? (
            <div className="empty-state">
              <h3>No cameras</h3>
              <p>Register a camera to begin access oversight.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
              {cameras.map((cam) => {
                const active = cam.is_active ?? cam.isActive ?? false;
                const camKey = cam.camera_id || cam._id || cam.name;
                return (
                  <div key={camKey} className="card" style={{ padding: '0.85rem', borderLeft: `3px solid ${active ? 'var(--success)' : 'var(--gray-300)'}` }}>
                    <div className="flex items-center justify-between mb-1">
                      <strong>{cam.name}</strong>
                      <span className={`badge ${active ? 'badge-success' : 'badge-gray'}`}>
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {cam.location && <p className="text-sm text-gray">{cam.location}</p>}
                    {cam.device_identifier && <p className="text-sm text-gray" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>ID: {cam.device_identifier}</p>}
                    <button className="btn btn-secondary btn-sm mt-2" onClick={() => openCameraForm(cam)}>Edit</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Test Detect */}
          <div className="card mt-4" style={{ padding: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>Test Face Detection</h3>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
                <label>Sample Frame (image file)</label>
                <input
                  ref={detectFileRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setTestImage(e.target.files?.[0] || null);
                    setDetectResult(null);
                  }}
                />
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleTestDetect}
                disabled={!testImage || detectLoading}
              >
                {detectLoading ? 'Detecting...' : 'Run Detect'}
              </button>
            </div>
            {detectResult && (
              <div className={`alert ${detectResult.error ? 'alert-error' : 'alert-success'}`} style={{ marginTop: '0.75rem' }}>
                {detectResult.error
                  ? `Error: ${detectResult.error}`
                  : `Faces detected: ${detectResult.faces ?? '—'} | Processing time: ${detectResult.processing_time_ms != null ? `${detectResult.processing_time_ms}ms` : '—'}`
                }
              </div>
            )}
          </div>
        </>
      )}

      {/* Events Tab */}
      {tab === 'events' && (
        <>
          <div className="card mb-4" style={{ padding: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Camera</label>
                <select value={filterCamera} onChange={(e) => { setFilterCamera(e.target.value); setEventPage(1); }}>
                  <option value="">All Cameras</option>
                  {cameras.map((c) => { const cid = c.camera_id || c._id || ''; return <option key={cid} value={cid}>{c.name}</option>; })}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Decision</label>
                <select value={filterDecision} onChange={(e) => { setFilterDecision(e.target.value); setEventPage(1); }}>
                  <option value="">All Decisions</option>
                  {Object.entries(DECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>From</label>
                <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setEventPage(1); }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>To</label>
                <input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setEventPage(1); }} />
              </div>
            </div>
          </div>

          {eventsLoading ? (
            <div className="loading"><div className="spinner" />Loading events...</div>
          ) : eventsError ? (
            <div className="alert alert-error">{eventsError}</div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <h3>No events</h3>
              <p>No face events found for these filters.</p>
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 0 }}>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Camera</th>
                        <th>User</th>
                        <th>Decision</th>
                        <th>Confidence</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev) => {
                        const camDisplay = ev.cameraId ? cameraName(ev.cameraId as { _id: string; name: string } | string) : (ev.camera_id || '—');
                        const userDisplay = ev.userId ? personName(ev.userId) : (ev.matched_user_id || '—');
                        const conf = ev.confidence_score ?? ev.confidence;
                        const ts = ev.occurred_at || ev.timestamp || '';
                        return (
                          <tr key={ev._id}>
                            <td>{camDisplay}</td>
                            <td>{userDisplay}</td>
                            <td>
                              <span className={`badge ${DECISION_BADGE[ev.decision] || 'badge-gray'}`}>
                                {DECISION_LABEL[ev.decision] || ev.decision}
                              </span>
                            </td>
                            <td>{conf != null ? `${(conf * 100).toFixed(1)}%` : '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{ts ? fmt(ts) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {eventPages > 1 && (
                <div className="pagination">
                  <button className="btn btn-secondary btn-sm" disabled={eventPage <= 1} onClick={() => setEventPage(eventPage - 1)}>Prev</button>
                  <span className="text-sm text-gray">Page {eventPage} of {eventPages}</span>
                  <button className="btn btn-secondary btn-sm" disabled={eventPage >= eventPages} onClick={() => setEventPage(eventPage + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Enrollments Tab */}
      {tab === 'enrollments' && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontSize: '1rem' }}>Face Enrollments by User</h2>
            <button className="btn btn-primary btn-sm" onClick={() => { setEnrollFormUserId(''); setEnrollFormConsent(false); setEnrollFormFiles([]); setEnrollFormError(''); setShowEnrollForm(true); }}>
              + Enroll User
            </button>
          </div>
          <div className="card mb-4" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, maxWidth: '320px' }}>
                <label>User ID</label>
                <input
                  type="text"
                  value={enrollmentUserId}
                  onChange={(e) => setEnrollmentUserId(e.target.value)}
                  placeholder="Enter user ID..."
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={fetchEnrollments}
                disabled={!enrollmentUserId.trim() || enrollmentsLoading}
              >
                {enrollmentsLoading ? 'Loading...' : 'Look Up'}
              </button>
            </div>
          </div>
          {enrollments.length === 0 ? (
            <div className="empty-state">
              <h3>No enrollments</h3>
              <p>{enrollmentUserId.trim() ? 'No face enrollments found for this user.' : 'Enter a user ID above to look up enrollments.'}</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Enrollment ID</th>
                      <th>Samples</th>
                      <th>Status</th>
                      <th>Consent</th>
                      <th>Enrolled At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map((e) => (
                      <tr key={e.enrollment_id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{e.enrollment_id}</td>
                        <td><span className="badge badge-primary">{e.sample_count}</span></td>
                        <td><span className={`badge ${e.status === 'active' ? 'badge-success' : 'badge-gray'}`}>{e.status}</span></td>
                        <td>
                          <span className={`badge ${e.consent_given ? 'badge-success' : 'badge-danger'}`}>
                            {e.consent_given ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{e.enrolled_at ? fmt(e.enrolled_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Enroll User Modal */}
      {showEnrollForm && (
        <div className="modal-overlay" onClick={() => setShowEnrollForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Enroll User for Face Recognition</h2>
            {enrollFormError && <div className="alert alert-error">{enrollFormError}</div>}
            <div className="form-group">
              <label>User ID</label>
              <input
                type="text"
                value={enrollFormUserId}
                onChange={(e) => setEnrollFormUserId(e.target.value)}
                placeholder="MongoDB user ID..."
              />
            </div>
            <div className="form-group">
              <label>Sample Images (minimum 3)</label>
              <input
                ref={enrollFileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setEnrollFormFiles(Array.from(e.target.files || []))}
              />
              {enrollFormFiles.length > 0 && (
                <p className="text-sm text-gray" style={{ marginTop: '0.35rem' }}>
                  {enrollFormFiles.length} file{enrollFormFiles.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enrollFormConsent}
                  onChange={(e) => setEnrollFormConsent(e.target.checked)}
                />
                I confirm the user has given explicit written consent for biometric enrollment
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowEnrollForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={enrollFormSubmitting} onClick={handleEnroll}>
                {enrollFormSubmitting ? 'Enrolling...' : 'Enroll'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Form Modal */}
      {showCameraForm && (
        <div className="modal-overlay" onClick={() => setShowCameraForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCamera ? 'Edit Camera' : 'Register Camera'}</h2>
            {fError && <div className="alert alert-error">{fError}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Camera name..." />
            </div>
            <div className="form-group">
              <label>Device Identifier{!editingCamera ? ' — required' : ' — optional'}</label>
              <input type="text" value={fDeviceId} onChange={(e) => setFDeviceId(e.target.value)} placeholder="Hardware device ID..." />
            </div>
            <div className="form-group">
              <label>Location — optional</label>
              <input type="text" value={fLocation} onChange={(e) => setFLocation(e.target.value)} placeholder="e.g. Entrance, Room A3" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCameraForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={fSubmitting} onClick={handleCameraSubmit}>
                {fSubmitting ? 'Saving...' : editingCamera ? 'Update' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
