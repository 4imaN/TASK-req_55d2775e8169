import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function Layout() {
  const { user, logout, isAdmin, isCreator, isModerator, isStaff } = useAuth();
  const initials = getInitials(user?.displayName || user?.username);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Close sidebar on escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="app-layout">
      {/* Mobile top bar */}
      <header className="mobile-topbar">
        <button className="mobile-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`} />
        </button>
        <div className="mobile-topbar-title">StudyRoomOps</div>
        <div className="mobile-topbar-avatar">{initials}</div>
      </header>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`app-sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">StudyRoomOps</div>
          <div className="sidebar-logo-subtitle">Room Management Platform</div>
        </div>

        <nav>
          <NavLink to="/dashboard">
            <span>⊞</span> Dashboard
          </NavLink>
          <NavLink to="/rooms">
            <span>🚪</span> Rooms
          </NavLink>
          <NavLink to="/reservations">
            <span>📅</span> Reservations
          </NavLink>
          <NavLink to="/favorites">
            <span>♡</span> Favorites
          </NavLink>
          <NavLink to="/leads">
            <span>✉</span> Leads
          </NavLink>
          <NavLink to="/reviews">
            <span>★</span> Reviews
          </NavLink>
          <NavLink to="/notifications">
            <span>◎</span> Notifications
          </NavLink>

          {isStaff && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Staff</div>
              {isCreator && <NavLink to="/staff/zones"><span>◈</span> Zones</NavLink>}
              {isCreator && <NavLink to="/staff/rooms"><span>⊟</span> Room Setup</NavLink>}
              {isCreator && <NavLink to="/staff/business-hours"><span>⏱</span> Business Hours</NavLink>}
              {isCreator && <NavLink to="/staff/reservations"><span>⊕</span> Reservation Ops</NavLink>}
              {isCreator && <NavLink to="/staff/leads"><span>⊸</span> Lead Management</NavLink>}
              {isModerator && <NavLink to="/staff/moderation"><span>⊛</span> Moderation Queue</NavLink>}
            </div>
          )}

          {isAdmin && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Admin</div>
              <NavLink to="/admin/users"><span>◉</span> Users</NavLink>
              <NavLink to="/admin/policies"><span>⊖</span> Policies</NavLink>
              <NavLink to="/admin/membership"><span>◈</span> Membership</NavLink>
              <NavLink to="/admin/blacklist"><span>⊘</span> Blacklist</NavLink>
              <NavLink to="/admin/disputes"><span>⊗</span> Disputes</NavLink>
              <NavLink to="/admin/analytics"><span>⊞</span> Analytics</NavLink>
              <NavLink to="/admin/exports"><span>⊻</span> Exports</NavLink>
              <NavLink to="/admin/audit"><span>⊷</span> Audit Logs</NavLink>
              <NavLink to="/admin/vision"><span>◎</span> Access Oversight</NavLink>
            </div>
          )}
        </nav>

        {/* User section */}
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.displayName || user?.username}</div>
            {user?.roles && user.roles.length > 0 && (
              <div className="sidebar-user-roles">
                {user.roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(', ')}
              </div>
            )}
          </div>
          <button className="sidebar-logout sidebar-link" onClick={logout} title="Log out">
            ↪
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
