import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPut } from '../utils/api';

interface Notification {
  _id: string;
  type: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  meta?: Record<string, unknown>;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function typeLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<Notification[]>('/notifications', {
      page: String(page),
      pageSize: '20',
    });
    if (res.ok && res.data) {
      setNotifications(res.data);
      setTotal((res.meta as { total?: number })?.total || 0);
    } else {
      setError(res.error?.message || 'Failed to load notifications');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    setMarkingId(id);
    const res = await apiPut(`/notifications/${id}/read`);
    if (res.ok) {
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    }
    setMarkingId(null);
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    const res = await apiPut('/notifications/read-all');
    if (res.ok) {
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    }
    setMarkingAll(false);
  };

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>
          Notifications{' '}
          {unreadCount > 0 && (
            <span className="badge badge-danger" style={{ fontSize: '0.8rem', verticalAlign: 'middle' }}>
              {unreadCount} unread
            </span>
          )}
        </h1>
        {unreadCount > 0 && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={markAllRead}
            disabled={markingAll}
          >
            {markingAll ? 'Marking...' : 'Mark all as read'}
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <h3>No notifications</h3>
          <p>You're all caught up. Notifications about your reservations and updates will appear here.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {notifications.map((n) => (
              <div
                key={n._id}
                className="card"
                style={{
                  borderLeft: `3px solid ${n.readAt ? 'var(--gray-200)' : 'var(--primary)'}`,
                  background: n.readAt ? 'white' : 'var(--primary-light)',
                  padding: '1rem 1.25rem',
                }}
              >
                <div className="flex items-center justify-between">
                  <div style={{ flex: 1 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>
                        {typeLabel(n.type)}
                      </span>
                      {!n.readAt && (
                        <span className="badge badge-primary" style={{ fontSize: '0.65rem' }}>New</span>
                      )}
                    </div>
                    <p className="text-sm" style={{ color: 'var(--gray-800)', marginBottom: '0.25rem' }}>
                      {n.message}
                    </p>
                    <span className="text-sm text-gray">{formatDate(n.createdAt)}</span>
                  </div>
                  {!n.readAt && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginLeft: '1rem', flexShrink: 0 }}
                      onClick={() => markAsRead(n._id)}
                      disabled={markingId === n._id}
                    >
                      {markingId === n._id ? 'Marking...' : 'Mark read'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {total > 20 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Prev
              </button>
              <span className="text-sm text-gray">Page {page} of {Math.ceil(total / 20)}</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
