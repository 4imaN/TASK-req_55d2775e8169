import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiGet } from '../utils/api';

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): { day: string; time: string } {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return { day, time };
}

export default function DashboardPage() {
  const { user, isStaff, isAdmin } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const { day, time } = formatDate();
  const initials = getInitials(user?.displayName || user?.username);

  useEffect(() => {
    apiGet<{ count: number }>('/notifications/unread-count').then((res) => {
      if (res.ok && res.data) setUnreadCount(res.data.count);
    });
  }, []);

  return (
    <div>
      {/* Greeting header */}
      <div className="dashboard-greeting">
        <h1>{getGreeting()}, {user?.displayName?.split(' ')[0] || user?.username}</h1>
        <div className="dashboard-date">
          <strong>{day}</strong>
          {time}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <Link to="/rooms" className="btn btn-primary">
          🚪 Browse Rooms
        </Link>
        <Link to="/reservations" className="btn btn-secondary">
          📅 My Reservations
        </Link>
        <Link to="/leads" className="btn btn-secondary">
          ✉ Submit Lead
        </Link>
        {unreadCount > 0 && (
          <Link to="/notifications" className="btn btn-accent">
            ◎ {unreadCount} Notification{unreadCount !== 1 ? 's' : ''}
          </Link>
        )}
      </div>

      {/* Main card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
        <Link to="/rooms" className="dash-card">
          <span className="dash-card-icon">🚪</span>
          <h3>Browse Rooms</h3>
          <p>Explore available study spaces and reserve your spot</p>
        </Link>

        <Link to="/reservations" className="dash-card">
          <span className="dash-card-icon">📅</span>
          <h3>My Reservations</h3>
          <p>View, manage, and track your upcoming bookings</p>
        </Link>

        <Link to="/favorites" className="dash-card">
          <span className="dash-card-icon">♡</span>
          <h3>Favorites</h3>
          <p>Quickly access your saved study rooms</p>
        </Link>

        <Link to="/leads" className="dash-card">
          <span className="dash-card-icon">✉</span>
          <h3>Lead Requests</h3>
          <p>Group study and long-term room requests</p>
        </Link>

        <Link to="/notifications" className="dash-card">
          <span className="dash-card-icon">◎</span>
          <h3>
            Notifications
            {unreadCount > 0 && (
              <span className="badge badge-danger" style={{ fontSize: '0.68rem' }}>{unreadCount}</span>
            )}
          </h3>
          <p>Reminders, alerts, and booking updates</p>
        </Link>

        <Link to="/reviews" className="dash-card">
          <span className="dash-card-icon">★</span>
          <h3>Reviews &amp; Q&amp;A</h3>
          <p>Community feedback and room insights</p>
        </Link>

        {isStaff && (
          <div className="dash-card dash-card-staff" style={{ cursor: 'default' }}>
            <span className="dash-card-icon">⚙</span>
            <h3>Staff Tools</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.625rem' }}>
              <Link to="/staff/zones" className="text-sm" style={{ color: 'var(--primary)', fontWeight: 500 }}>Zone Management</Link>
              <Link to="/staff/rooms" className="text-sm" style={{ color: 'var(--primary)', fontWeight: 500 }}>Room Setup</Link>
              <Link to="/staff/leads" className="text-sm" style={{ color: 'var(--primary)', fontWeight: 500 }}>Lead Pipeline</Link>
              <Link to="/staff/moderation" className="text-sm" style={{ color: 'var(--primary)', fontWeight: 500 }}>Moderation Queue</Link>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="dash-card dash-card-admin" style={{ cursor: 'default' }}>
            <span className="dash-card-icon">◈</span>
            <h3>Administration</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.625rem' }}>
              <Link to="/admin/analytics" className="text-sm" style={{ color: 'var(--accent)', fontWeight: 500 }}>Analytics</Link>
              <Link to="/admin/membership" className="text-sm" style={{ color: 'var(--accent)', fontWeight: 500 }}>Membership</Link>
              <Link to="/admin/audit" className="text-sm" style={{ color: 'var(--accent)', fontWeight: 500 }}>Audit Logs</Link>
              <Link to="/admin/vision" className="text-sm" style={{ color: 'var(--accent)', fontWeight: 500 }}>Access Oversight</Link>
            </div>
          </div>
        )}
      </div>

      {/* Profile card */}
      <div className="profile-card">
        <div className="profile-avatar-lg">{initials}</div>
        <div className="profile-info">
          <h3>{user?.displayName || user?.username}</h3>
          <div className="text-sm text-gray">@{user?.username}</div>
          <div className="profile-meta">
            {user?.reputationTier && (
              <span className="badge badge-success">
                ★ {user.reputationTier}
              </span>
            )}
            {user?.roles && user.roles.map((r) => (
              <span key={r} className="badge badge-primary">
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
