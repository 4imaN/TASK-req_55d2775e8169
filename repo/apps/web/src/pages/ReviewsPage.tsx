import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiGet, apiPost, apiPut, fetchCsrfToken, getCsrfToken } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

interface Room {
  _id: string;
  name: string;
}

interface EligibleReservation {
  _id: string;
  roomId: string;
  startAtUtc: string;
  status: string;
}

interface ReviewMedia {
  _id: string;
  reviewId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  createdAt: string;
}

interface Author {
  _id: string;
  displayName: string;
  reputationTier?: string;
}

interface Review {
  _id: string;
  roomId: string;
  userId: string;
  author?: Author;
  rating: number;
  text: string;
  featured?: boolean;
  createdAt: string;
  media?: ReviewMedia[];
}

interface QAThread {
  _id: string;
  roomId: string;
  title: string;
  userId: string;
  author?: Author;
  isPinned?: boolean;
  postCount: number;
  createdAt: string;
}

interface QAPost {
  _id: string;
  threadId: string;
  userId: string;
  author?: Author;
  body: string;
  createdAt: string;
}

function authorName(author?: Author): string {
  return author?.displayName || 'Unknown';
}

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span style={{ color: '#f59e0b', fontSize: '1rem' }} title={`${rating}/${max}`}>
      {'★'.repeat(Math.round(rating))}{'☆'.repeat(max - Math.round(rating))}
    </span>
  );
}

function ReputationBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const cls =
    tier === 'Expert' ? 'badge-success' :
    tier === 'Trusted' ? 'badge-primary' :
    'badge-gray';
  return <span className={`badge ${cls}`} style={{ fontSize: '0.7rem' }}>{tier}</span>;
}

export default function ReviewsPage() {
  const { user, isModerator, isAdmin } = useAuth();
  const isMod = isModerator || isAdmin;
  const [tab, setTab] = useState<'reviews' | 'qa'>('reviews');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomMap, setRoomMap] = useState<Record<string, string>>({});
  const [selectedRoom, setSelectedRoom] = useState('');

  // Reviews state
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState('');

  // Write review modal
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [revRating, setRevRating] = useState(5);
  const [revText, setRevText] = useState('');
  const [revReservationId, setRevReservationId] = useState('');
  const [revSubmitting, setRevSubmitting] = useState(false);
  const [revError, setRevError] = useState('');
  const [revSuccess, setRevSuccess] = useState('');
  const [eligibleReservations, setEligibleReservations] = useState<EligibleReservation[]>([]);
  const [revFiles, setRevFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Q&A state
  const [threads, setThreads] = useState<QAThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState('');
  const [selectedThread, setSelectedThread] = useState<QAThread | null>(null);
  const [posts, setPosts] = useState<QAPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  const [reportTarget, setReportTarget] = useState<{ type: string; id: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState('');

  // New Q&A thread modal state
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadRoom, setNewThreadRoom] = useState('');
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [newThreadSubmitting, setNewThreadSubmitting] = useState(false);
  const [newThreadError, setNewThreadError] = useState('');

  const fetchRooms = useCallback(async () => {
    const res = await apiGet<Room[]>('/rooms', { pageSize: '200' });
    if (res.ok && res.data) {
      setRooms(res.data);
      const map: Record<string, string> = {};
      for (const r of res.data) { map[r._id] = r.name; }
      setRoomMap(map);
      if (res.data.length > 0 && !selectedRoom) setSelectedRoom(res.data[0]._id);
    }
  }, [selectedRoom]);

  const fetchEligibleReservations = useCallback(async () => {
    const [checkedInRes, completedRes] = await Promise.all([
      apiGet<EligibleReservation[]>('/reservations', { status: 'checked_in', mine: 'true' }),
      apiGet<EligibleReservation[]>('/reservations', { status: 'completed', mine: 'true' }),
    ]);
    const combined: EligibleReservation[] = [
      ...(checkedInRes.ok && checkedInRes.data ? checkedInRes.data : []),
      ...(completedRes.ok && completedRes.data ? completedRes.data : []),
    ];
    setEligibleReservations(combined);
    if (combined.length > 0 && !revReservationId) setRevReservationId(combined[0]._id);
  }, [revReservationId]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const fetchReviews = useCallback(async () => {
    if (!selectedRoom) return;
    setReviewsLoading(true);
    setReviewsError('');
    const res = await apiGet<Review[]>('/reviews', { roomId: selectedRoom });
    if (res.ok && res.data) setReviews(res.data);
    else setReviewsError(res.error?.message || 'Failed to load reviews');
    setReviewsLoading(false);
  }, [selectedRoom]);

  const fetchThreads = useCallback(async () => {
    if (!selectedRoom) return;
    setThreadsLoading(true);
    setThreadsError('');
    const res = await apiGet<QAThread[]>('/qa-threads', { roomId: selectedRoom });
    if (res.ok && res.data) setThreads(res.data);
    else setThreadsError(res.error?.message || 'Failed to load threads');
    setThreadsLoading(false);
  }, [selectedRoom]);

  useEffect(() => {
    if (tab === 'reviews') fetchReviews();
    else fetchThreads();
  }, [tab, selectedRoom, fetchReviews, fetchThreads]);

  async function fetchPosts(threadId: string) {
    setPostsLoading(true);
    const res = await apiGet<QAPost[]>(`/qa-threads/${threadId}/posts`);
    if (res.ok && res.data) setPosts(res.data);
    setPostsLoading(false);
  }

  function openThread(thread: QAThread) {
    setSelectedThread(thread);
    setPosts([]);
    setReplyText('');
    fetchPosts(thread._id);
  }

  async function handleWriteReview() {
    if (!revText.trim()) { setRevError('Please write a review.'); return; }
    if (!revReservationId) { setRevError('Please select a reservation to review.'); return; }
    if (revFiles.length > 5) { setRevError('Maximum 5 images allowed.'); return; }
    setRevSubmitting(true);
    setRevError('');
    const idempotencyKey = Date.now() + '-' + Math.random().toString(36).slice(2);
    const res = await apiPost<{ _id: string }>('/reviews', { reservationId: revReservationId, rating: revRating, text: revText, idempotencyKey });
    if (res.ok && res.data) {
      // Upload selected images if any
      let mediaFailed = false;
      if (revFiles.length > 0) {
        try {
          const formData = new FormData();
          for (const file of revFiles) {
            formData.append('media', file);
          }
          let csrf = getCsrfToken();
          if (!csrf) csrf = await fetchCsrfToken();
          const uploadRes = await fetch(`/api/v1/reviews/${res.data._id}/media`, {
            method: 'POST',
            headers: { 'x-csrf-token': csrf || '' },
            credentials: 'include',
            body: formData,
          });
          if (!uploadRes.ok) {
            mediaFailed = true;
          }
        } catch {
          mediaFailed = true;
        }
      }
      if (mediaFailed) {
        setRevSuccess('Review submitted, but photo upload failed. You can try adding photos later.');
      } else {
        setRevSuccess('Review submitted!');
      }
      setShowReviewForm(false);
      setRevText('');
      setRevRating(5);
      setRevReservationId('');
      setRevFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchReviews();
      setTimeout(() => setRevSuccess(''), 5000);
    } else {
      setRevError(res.error?.message || 'Failed to submit review');
    }
    setRevSubmitting(false);
  }

  async function handleReply() {
    if (!selectedThread || !replyText.trim()) return;
    setReplySubmitting(true);
    const res = await apiPost(`/qa-threads/${selectedThread._id}/posts`, { body: replyText });
    if (res.ok) {
      setReplyText('');
      fetchPosts(selectedThread._id);
    }
    setReplySubmitting(false);
  }

  async function handleReport() {
    if (!reportTarget || !reportReason.trim()) return;
    setReportSubmitting(true);
    const res = await apiPost('/moderation/reports', {
      contentType: reportTarget.type,
      contentId: reportTarget.id,
      reason: reportReason,
    });
    if (res.ok) {
      setReportSuccess('Report submitted.');
      setReportTarget(null);
      setReportReason('');
      setTimeout(() => setReportSuccess(''), 3000);
    }
    setReportSubmitting(false);
  }

  async function handleNewThread() {
    if (newThreadTitle.trim().length < 10 || newThreadTitle.trim().length > 1000) {
      setNewThreadError('Title must be between 10 and 1000 characters.');
      return;
    }
    if (newThreadBody.trim().length < 10 || newThreadBody.trim().length > 1000) {
      setNewThreadError('Body must be between 10 and 1000 characters.');
      return;
    }
    if (!newThreadRoom) {
      setNewThreadError('Please select a room.');
      return;
    }
    setNewThreadSubmitting(true);
    setNewThreadError('');
    const res = await apiPost('/qa-threads', { roomId: newThreadRoom, title: newThreadTitle.trim(), body: newThreadBody.trim() });
    if (res.ok) {
      setShowNewThread(false);
      setNewThreadTitle('');
      setNewThreadBody('');
      setNewThreadRoom(selectedRoom);
      fetchThreads();
    } else {
      setNewThreadError(res.error?.message || 'Failed to create thread');
    }
    setNewThreadSubmitting(false);
  }

  async function handleFeature(reviewId: string, currentFeatured: boolean) {
    await apiPost(`/reviews/${reviewId}/feature`, { featured: !currentFeatured });
    fetchReviews();
  }

  async function handlePin(threadId: string, isPinned: boolean) {
    await apiPut(`/qa-threads/${threadId}/pin`, { isPinned });
    fetchThreads();
  }

  async function handleCollapse(threadId: string) {
    await apiPut(`/qa-threads/${threadId}/collapse`);
    fetchThreads();
  }

  return (
    <div>
      <h1>Reviews & Q&A</h1>

      {reportSuccess && <div className="alert alert-success">{reportSuccess}</div>}

      {/* Room selector */}
      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div className="form-group" style={{ marginBottom: 0, maxWidth: '300px' }}>
          <label>Select Room</label>
          <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}>
            {rooms.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`btn ${tab === 'reviews' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('reviews')}
        >Reviews</button>
        <button
          className={`btn ${tab === 'qa' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('qa')}
        >Q&A</button>
      </div>

      {/* Reviews Tab */}
      {tab === 'reviews' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</span>
            {user && (
              <button className="btn btn-primary" onClick={() => { setShowReviewForm(true); setRevError(''); fetchEligibleReservations(); }}>
                Write Review
              </button>
            )}
          </div>

          {revSuccess && <div className="alert alert-success">{revSuccess}</div>}

          {reviewsLoading ? (
            <div className="loading"><div className="spinner" />Loading reviews...</div>
          ) : reviews.length === 0 ? (
            <div className="empty-state">
              <h3>No reviews yet</h3>
              <p>Be the first to review this room.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {reviews.map((rev) => (
                <div key={rev._id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StarRating rating={rev.rating} />
                      {rev.featured && <span className="badge badge-warning">Featured</span>}
                    </div>
                    <div className="flex gap-1">
                      {isMod && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleFeature(rev._id, !!rev.featured)}
                        >
                          {rev.featured ? 'Unfeature' : 'Feature'}
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setReportTarget({ type: 'review', id: rev._id })}
                      >
                        Report
                      </button>
                    </div>
                  </div>
                  <p style={{ marginBottom: '0.5rem' }}>{rev.text}</p>
                  {rev.media && rev.media.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {rev.media.map((m) => {
                        const downloadUrl = `/api/v1/reviews/${rev._id}/media/${m._id}/download`;
                        const isImage = m.mimeType.startsWith('image/');
                        return (
                          <a
                            key={m._id}
                            href={downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={m.originalName}
                            style={{ display: 'inline-block' }}
                          >
                            {isImage ? (
                              <img
                                src={downloadUrl}
                                alt={m.originalName}
                                style={{
                                  width: '80px',
                                  height: '80px',
                                  objectFit: 'cover',
                                  borderRadius: '4px',
                                  border: '1px solid var(--gray-200)',
                                }}
                              />
                            ) : (
                              <div style={{
                                width: '80px',
                                height: '80px',
                                background: 'var(--gray-100)',
                                borderRadius: '4px',
                                border: '1px solid var(--gray-200)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.65rem',
                                color: 'var(--gray-500)',
                                textAlign: 'center',
                                overflow: 'hidden',
                                padding: '4px',
                              }}>
                                {m.originalName}
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 text-sm text-gray items-center">
                    <span>{authorName(rev.author)}</span>
                    <ReputationBadge tier={rev.author?.reputationTier} />
                    <span>·</span>
                    <span>{fmt(rev.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {reviewsError && <div className="alert alert-error">{reviewsError}</div>}
        </>
      )}

      {/* Q&A Tab */}
      {tab === 'qa' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray">{threads.length} thread{threads.length !== 1 ? 's' : ''}</span>
            {user && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setNewThreadRoom(selectedRoom);
                  setNewThreadTitle('');
                  setNewThreadBody('');
                  setNewThreadError('');
                  setShowNewThread(true);
                }}
              >
                New Question
              </button>
            )}
          </div>

          {threadsLoading ? (
            <div className="loading"><div className="spinner" />Loading threads...</div>
          ) : threadsError ? (
            <div className="alert alert-error">{threadsError}</div>
          ) : threads.length === 0 ? (
            <div className="empty-state">
              <h3>No questions yet</h3>
              <p>Ask a question about this room.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Author</th>
                      <th>Posts</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {threads.map((t) => (
                      <tr key={t._id}>
                        <td>
                          <span style={{ fontWeight: 500 }}>{t.title}</span>
                          {t.isPinned && <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>Pinned</span>}
                        </td>
                        <td>
                          <span className="flex items-center gap-1">
                            {authorName(t.author)}
                            <ReputationBadge tier={t.author?.reputationTier} />
                          </span>
                        </td>
                        <td>{t.postCount}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmt(t.createdAt)}</td>
                        <td>
                          <div className="flex gap-1">
                            <button className="btn btn-secondary btn-sm" onClick={() => openThread(t)}>View</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setReportTarget({ type: 'qa_thread', id: t._id })}>Report</button>
                            {isMod && (
                              <>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handlePin(t._id, !t.isPinned)}
                                  title={t.isPinned ? 'Unpin' : 'Pin'}
                                >
                                  {t.isPinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleCollapse(t._id)}
                                  title="Collapse thread"
                                >
                                  Collapse
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
          )}
        </>
      )}

      {/* Write Review Modal */}
      {showReviewForm && (
        <div className="modal-overlay" onClick={() => setShowReviewForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Write a Review</h2>
            {revError && <div className="alert alert-error">{revError}</div>}
            <div className="form-group">
              <label>Reservation</label>
              {eligibleReservations.length === 0 ? (
                <p className="text-sm text-gray">No eligible reservations (checked-in or completed) found.</p>
              ) : (
                <select value={revReservationId} onChange={(e) => setRevReservationId(e.target.value)}>
                  <option value="">Select a reservation...</option>
                  {eligibleReservations.map((r) => {
                    const date = new Date(r.startAtUtc).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    return (
                      <option key={r._id} value={r._id}>{roomMap[r.roomId] || r.roomId} — {date} ({r.status})</option>
                    );
                  })}
                </select>
              )}
            </div>
            <div className="form-group">
              <label>Rating</label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRevRating(n)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '1.75rem',
                      color: n <= revRating ? '#f59e0b' : 'var(--gray-300)',
                      padding: '0 0.1rem',
                    }}
                  >★</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Review</label>
              <textarea rows={4} value={revText} onChange={(e) => setRevText(e.target.value)} placeholder="Share your experience..." />
            </div>
            <div className="form-group">
              <label>Photos (optional, max 5 — JPEG or PNG)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                multiple
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []).slice(0, 5);
                  setRevFiles(selected);
                }}
              />
              {revFiles.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {revFiles.map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img
                        src={URL.createObjectURL(f)}
                        alt={f.name}
                        style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--gray-200)' }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowReviewForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={revSubmitting} onClick={handleWriteReview}>
                {revSubmitting ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thread Detail Modal */}
      {selectedThread && (
        <div className="modal-overlay" onClick={() => setSelectedThread(null)}>
          <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <h2>{selectedThread.title}</h2>
            {postsLoading ? (
              <div className="loading"><div className="spinner" />Loading...</div>
            ) : posts.length === 0 ? (
              <p className="text-sm text-gray">No posts yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
                {posts.map((p) => (
                  <div key={p._id} style={{ padding: '0.75rem', background: 'var(--gray-50)', borderRadius: 'var(--radius)' }}>
                    <p style={{ marginBottom: '0.35rem' }}>{p.body}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray flex items-center gap-1">
                        {authorName(p.author)}
                        <ReputationBadge tier={p.author?.reputationTier} />
                        · {fmt(p.createdAt)}
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={() => setReportTarget({ type: 'qa_post', id: p._id })}>Report</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {user && (
              <div>
                <div className="form-group">
                  <label>Reply</label>
                  <textarea rows={3} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Add your reply..." />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedThread(null)}>Close</button>
              {user && (
                <button className="btn btn-primary" disabled={replySubmitting || !replyText.trim()} onClick={handleReply}>
                  {replySubmitting ? 'Posting...' : 'Post Reply'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {reportTarget && (
        <div className="modal-overlay" onClick={() => setReportTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Report Content</h2>
            <div className="form-group">
              <label>Reason</label>
              <textarea rows={3} value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Why are you reporting this?" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setReportTarget(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={reportSubmitting || !reportReason.trim()} onClick={handleReport}>
                {reportSubmitting ? 'Reporting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Q&A Thread Modal */}
      {showNewThread && (
        <div className="modal-overlay" onClick={() => setShowNewThread(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Ask a Question</h2>
            {newThreadError && <div className="alert alert-error">{newThreadError}</div>}
            <div className="form-group">
              <label>Room</label>
              <select value={newThreadRoom} onChange={(e) => setNewThreadRoom(e.target.value)}>
                <option value="">Select a room...</option>
                {rooms.map((r) => (
                  <option key={r._id} value={r._id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Title (10–1000 characters)</label>
              <input
                type="text"
                value={newThreadTitle}
                onChange={(e) => setNewThreadTitle(e.target.value)}
                placeholder="What's your question?"
                maxLength={1000}
              />
            </div>
            <div className="form-group">
              <label>Body (10–1000 characters)</label>
              <textarea
                rows={4}
                value={newThreadBody}
                onChange={(e) => setNewThreadBody(e.target.value)}
                placeholder="Provide more details..."
                maxLength={1000}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewThread(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={newThreadSubmitting}
                onClick={handleNewThread}
              >
                {newThreadSubmitting ? 'Posting...' : 'Post Question'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
