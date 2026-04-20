import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPut } from '../../utils/api';

interface Report {
  _id: string;
  contentType: string;
  contentId: string;
  reporterUserId: { _id: string; displayName: string } | string;
  status: 'open' | 'under_review' | 'actioned' | 'dismissed';
  reason?: string;
  createdAt: string;
}

interface Appeal {
  _id: string;
  appellantUserId: { _id: string; displayName: string } | string;
  reason: string;
  contentType?: string;
  contentId?: string;
  status: 'submitted' | 'under_review' | 'accepted' | 'denied';
  createdAt: string;
}

const REPORT_STATUS_BADGE: Record<string, string> = {
  open: 'badge-warning',
  under_review: 'badge-primary',
  actioned: 'badge-danger',
  dismissed: 'badge-gray',
};

const REPORT_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  under_review: 'Under Review',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

const APPEAL_STATUS_BADGE: Record<string, string> = {
  submitted: 'badge-warning',
  under_review: 'badge-primary',
  accepted: 'badge-success',
  denied: 'badge-danger',
};

const APPEAL_STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  accepted: 'Accepted',
  denied: 'Denied',
};

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function personName(u: { _id: string; displayName: string } | string) {
  return typeof u === 'object' ? u.displayName : u;
}

export default function ModerationPage() {
  const [tab, setTab] = useState<'reports' | 'appeals'>('reports');

  // Reports
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [reportPage, setReportPage] = useState(1);
  const [reportTotal, setReportTotal] = useState(0);

  // Appeals
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealsError, setAppealsError] = useState('');
  const [appealPage, setAppealPage] = useState(1);
  const [appealTotal, setAppealTotal] = useState(0);

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const pageSize = 15;

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    setReportsError('');
    const res = await apiGet<Report[]>('/moderation/reports', { page: String(reportPage), pageSize: String(pageSize) });
    if (res.ok && res.data) {
      setReports(res.data);
      setReportTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setReportsError(res.error?.message || 'Failed to load reports');
    }
    setReportsLoading(false);
  }, [reportPage]);

  const fetchAppeals = useCallback(async () => {
    setAppealsLoading(true);
    setAppealsError('');
    const res = await apiGet<Appeal[]>('/moderation/appeals', { page: String(appealPage), pageSize: String(pageSize) });
    if (res.ok && res.data) {
      setAppeals(res.data);
      setAppealTotal((res.meta as { total?: number })?.total || res.data.length);
    } else {
      setAppealsError(res.error?.message || 'Failed to load appeals');
    }
    setAppealsLoading(false);
  }, [appealPage]);

  useEffect(() => { if (tab === 'reports') fetchReports(); }, [tab, fetchReports]);
  useEffect(() => { if (tab === 'appeals') fetchAppeals(); }, [tab, fetchAppeals]);

  async function reportAction(reportId: string, newStatus: 'under_review' | 'actioned' | 'dismissed') {
    setActionLoading(reportId + newStatus);
    setError('');
    const res = await apiPut(`/moderation/reports/${reportId}`, { status: newStatus });
    if (res.ok) {
      const label = newStatus === 'under_review' ? 'marked under review' : newStatus === 'actioned' ? 'actioned' : 'dismissed';
      setSuccess(`Report ${label}.`);
      fetchReports();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Action failed');
    }
    setActionLoading(null);
  }

  async function appealAction(appealId: string, newStatus: 'accepted' | 'denied') {
    setActionLoading(appealId + newStatus);
    setError('');
    const res = await apiPut(`/moderation/appeals/${appealId}`, { status: newStatus });
    if (res.ok) {
      setSuccess(`Appeal ${newStatus}.`);
      fetchAppeals();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Action failed');
    }
    setActionLoading(null);
  }

  const reportPages = Math.ceil(reportTotal / pageSize);
  const appealPages = Math.ceil(appealTotal / pageSize);

  return (
    <div>
      <h1>Moderation Queue</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button
          className={`btn ${tab === 'reports' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('reports')}
        >
          Reports
        </button>
        <button
          className={`btn ${tab === 'appeals' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('appeals')}
        >
          Appeals
        </button>
      </div>

      {/* Reports Tab */}
      {tab === 'reports' && (
        <>
          {reportsLoading ? (
            <div className="loading"><div className="spinner" />Loading reports...</div>
          ) : reportsError ? (
            <div className="alert alert-error">{reportsError}</div>
          ) : reports.length === 0 ? (
            <div className="empty-state">
              <h3>No reports</h3>
              <p>The moderation queue is clear.</p>
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 0 }}>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Content</th>
                        <th>Reporter</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((r) => (
                        <tr key={r._id}>
                          <td>
                            <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>
                              {r.contentType.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ maxWidth: '180px' }}>
                            <span
                              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                              title={r.contentId}
                            >
                              {r.contentType}: {r.contentId}
                            </span>
                          </td>
                          <td>{personName(r.reporterUserId)}</td>
                          <td style={{ maxWidth: '140px' }}>
                            <span style={{ fontSize: '0.85rem' }}>{r.reason || '—'}</span>
                          </td>
                          <td>
                            <span className={`badge ${REPORT_STATUS_BADGE[r.status] || 'badge-gray'}`}>
                              {REPORT_STATUS_LABEL[r.status] || r.status}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.createdAt)}</td>
                          <td>
                            <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                              {r.status === 'open' && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  disabled={actionLoading === r._id + 'under_review'}
                                  onClick={() => reportAction(r._id, 'under_review')}
                                >
                                  Review
                                </button>
                              )}
                              {(r.status === 'open' || r.status === 'under_review') && (
                                <>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    disabled={actionLoading === r._id + 'actioned'}
                                    onClick={() => reportAction(r._id, 'actioned')}
                                  >
                                    Action
                                  </button>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    disabled={actionLoading === r._id + 'dismissed'}
                                    onClick={() => reportAction(r._id, 'dismissed')}
                                  >
                                    Dismiss
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {reportPages > 1 && (
                <div className="pagination">
                  <button className="btn btn-secondary btn-sm" disabled={reportPage <= 1} onClick={() => setReportPage(reportPage - 1)}>Prev</button>
                  <span className="text-sm text-gray">Page {reportPage} of {reportPages}</span>
                  <button className="btn btn-secondary btn-sm" disabled={reportPage >= reportPages} onClick={() => setReportPage(reportPage + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Appeals Tab */}
      {tab === 'appeals' && (
        <>
          {appealsLoading ? (
            <div className="loading"><div className="spinner" />Loading appeals...</div>
          ) : appealsError ? (
            <div className="alert alert-error">{appealsError}</div>
          ) : appeals.length === 0 ? (
            <div className="empty-state">
              <h3>No appeals</h3>
              <p>No pending appeals at this time.</p>
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 0 }}>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Appellant</th>
                        <th>Reason</th>
                        <th>Content</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appeals.map((a) => (
                        <tr key={a._id}>
                          <td>{personName(a.appellantUserId)}</td>
                          <td style={{ maxWidth: '200px' }}>
                            <span style={{ fontSize: '0.85rem' }}>{a.reason}</span>
                          </td>
                          <td style={{ maxWidth: '150px' }}>
                            <span
                              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                              title={a.contentId}
                            >
                              {a.contentType && a.contentId ? `${a.contentType}: ${a.contentId}` : '—'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${APPEAL_STATUS_BADGE[a.status] || 'badge-gray'}`}>
                              {APPEAL_STATUS_LABEL[a.status] || a.status}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmt(a.createdAt)}</td>
                          <td>
                            {(a.status === 'submitted' || a.status === 'under_review') && (
                              <div className="flex gap-1">
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={actionLoading === a._id + 'accepted'}
                                  onClick={() => appealAction(a._id, 'accepted')}
                                >
                                  Accept
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  disabled={actionLoading === a._id + 'denied'}
                                  onClick={() => appealAction(a._id, 'denied')}
                                >
                                  Deny
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {appealPages > 1 && (
                <div className="pagination">
                  <button className="btn btn-secondary btn-sm" disabled={appealPage <= 1} onClick={() => setAppealPage(appealPage - 1)}>Prev</button>
                  <span className="text-sm text-gray">Page {appealPage} of {appealPages}</span>
                  <button className="btn btn-secondary btn-sm" disabled={appealPage >= appealPages} onClick={() => setAppealPage(appealPage + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
