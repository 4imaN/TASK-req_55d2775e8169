import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from '../src/pages/LoginPage';
import { AuthProvider } from '../src/contexts/AuthContext';

// Mock the api module
vi.mock('../src/utils/api', () => ({
  apiGet: vi.fn().mockResolvedValue({ ok: false }),
  apiPost: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <BrowserRouter>
      <AuthProvider>
        {ui}
      </AuthProvider>
    </BrowserRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form', async () => {
    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('StudyRoomOps')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows link to register', async () => {
    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Create one')).toBeInTheDocument();
    });
  });

  it('validates required fields', async () => {
    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      const usernameInput = screen.getByLabelText('Username');
      expect(usernameInput).toBeRequired();
    });

    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toBeRequired();
  });
});
