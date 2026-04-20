import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import ProtectedRoute from '../src/components/ProtectedRoute';

// Mock useAuth to control auth state
const mockUseAuth = vi.fn();

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('ProtectedRoute', () => {
  it('shows loading state', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, hasRole: () => false });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, hasRole: () => false });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={
            <ProtectedRoute><div>Dashboard</div></ProtectedRoute>
          } />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { _id: '1', username: 'test', roles: [] },
      loading: false,
      hasRole: () => true,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('shows permission denied for missing role', () => {
    mockUseAuth.mockReturnValue({
      user: { _id: '1', username: 'test', roles: [] },
      loading: false,
      hasRole: () => false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute requiredRole="administrator">
          <div>Admin Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
