import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import RoomsPage from './pages/RoomsPage';
import ReservationsPage from './pages/ReservationsPage';
import FavoritesPage from './pages/FavoritesPage';
import LeadsPage from './pages/LeadsPage';
import ReviewsPage from './pages/ReviewsPage';
import NotificationsPage from './pages/NotificationsPage';
import ZoneManagementPage from './pages/staff/ZoneManagementPage';
import RoomSetupPage from './pages/staff/RoomSetupPage';
import BusinessHoursPage from './pages/staff/BusinessHoursPage';
import ReservationOpsPage from './pages/staff/ReservationOpsPage';
import LeadManagementPage from './pages/staff/LeadManagementPage';
import ModerationPage from './pages/staff/ModerationPage';
import UsersPage from './pages/admin/UsersPage';
import PoliciesPage from './pages/admin/PoliciesPage';
import MembershipPage from './pages/admin/MembershipPage';
import BlacklistPage from './pages/admin/BlacklistPage';
import DisputesPage from './pages/admin/DisputesPage';
import AnalyticsPage from './pages/admin/AnalyticsPage';
import ExportsPage from './pages/admin/ExportsPage';
import AuditPage from './pages/admin/AuditPage';
import VisionPage from './pages/admin/VisionPage';
import SharedReservationPage from './pages/SharedReservationPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        Loading StudyRoomOps...
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* Staff routes */}
        <Route path="/staff/zones" element={<ProtectedRoute requiredRole="creator"><ZoneManagementPage /></ProtectedRoute>} />
        <Route path="/staff/rooms" element={<ProtectedRoute requiredRole="creator"><RoomSetupPage /></ProtectedRoute>} />
        <Route path="/staff/business-hours" element={<ProtectedRoute requiredRole="creator"><BusinessHoursPage /></ProtectedRoute>} />
        <Route path="/staff/reservations" element={<ProtectedRoute requiredRole="creator"><ReservationOpsPage /></ProtectedRoute>} />
        <Route path="/staff/leads" element={<ProtectedRoute requiredRole="creator"><LeadManagementPage /></ProtectedRoute>} />
        <Route path="/staff/moderation" element={<ProtectedRoute requiredRole="moderator"><ModerationPage /></ProtectedRoute>} />

        {/* Admin routes */}
        <Route path="/admin/users" element={<ProtectedRoute requiredRole="administrator"><UsersPage /></ProtectedRoute>} />
        <Route path="/admin/policies" element={<ProtectedRoute requiredRole="administrator"><PoliciesPage /></ProtectedRoute>} />
        <Route path="/admin/membership" element={<ProtectedRoute requiredRole="administrator"><MembershipPage /></ProtectedRoute>} />
        <Route path="/admin/blacklist" element={<ProtectedRoute requiredRole="administrator"><BlacklistPage /></ProtectedRoute>} />
        <Route path="/admin/disputes" element={<ProtectedRoute requiredRole="administrator"><DisputesPage /></ProtectedRoute>} />
        <Route path="/admin/analytics" element={<ProtectedRoute requiredRole="administrator"><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/admin/exports" element={<ProtectedRoute requiredRole="administrator"><ExportsPage /></ProtectedRoute>} />
        <Route path="/admin/audit" element={<ProtectedRoute requiredRole="administrator"><AuditPage /></ProtectedRoute>} />
        <Route path="/admin/vision" element={<ProtectedRoute requiredRole="administrator"><VisionPage /></ProtectedRoute>} />
      </Route>

      {/* Shared reservation route */}
      <Route path="/shared/:token" element={<ProtectedRoute><SharedReservationPage /></ProtectedRoute>} />

      {/* Default redirect */}
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}
