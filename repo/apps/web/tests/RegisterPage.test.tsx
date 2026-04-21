import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RegisterPage from '../src/pages/RegisterPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockRegister = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: vi.fn().mockResolvedValue({ ok: false }),
  apiPost: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    loading: false,
    register: mockRegister,
    login: vi.fn(),
    logout: vi.fn(),
    hasRole: () => false,
    isAdmin: false,
    isCreator: false,
    isModerator: false,
    isStaff: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <BrowserRouter>
      {ui}
    </BrowserRouter>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Renders form elements', () => {
    it('renders Create Account heading', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    it('renders the Join StudyRoomOps tagline', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByText(/join studyroomops/i)).toBeInTheDocument();
    });

    it('renders username input', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Username')).toBeInTheDocument();
    });

    it('renders display name input', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    });

    it('renders password input', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('renders phone input', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    });

    it('renders sign in link for existing users', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    });
  });

  describe('Field validation attributes', () => {
    it('username is required', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Username')).toBeRequired();
    });

    it('display name is required', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Display Name')).toBeRequired();
    });

    it('password is required', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Password')).toBeRequired();
    });

    it('phone is optional (not required)', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText(/phone/i)).not.toBeRequired();
    });

    it('password input has type password', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    });

    it('username has minLength of 3', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Username')).toHaveAttribute('minLength', '3');
    });

    it('password has minLength of 12', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '12');
    });

    it('shows password hint about minimum length', () => {
      renderWithProviders(<RegisterPage />);

      expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    });
  });

  describe('Successful registration', () => {
    it('calls register with correct arguments on submit', async () => {
      mockRegister.mockResolvedValue({ ok: true });

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });
      fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '4155550136' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith(
          'newuser',
          'supersecret1234',
          'New User',
          '4155550136'
        );
      });
    });

    it('omits phone argument when phone field is empty', async () => {
      mockRegister.mockResolvedValue({ ok: true });

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith(
          'newuser',
          'supersecret1234',
          'New User',
          undefined
        );
      });
    });

    it('navigates to /dashboard after successful registration', async () => {
      mockRegister.mockResolvedValue({ ok: true });

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });
  });

  describe('Failed registration', () => {
    it('shows error message from register result', async () => {
      mockRegister.mockResolvedValue({ ok: false, error: 'Username already taken' });

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'existing' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Existing User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText('Username already taken')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message is provided', async () => {
      mockRegister.mockResolvedValue({ ok: false });

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText('Registration failed')).toBeInTheDocument();
      });
    });

    it('does not navigate on registration failure', async () => {
      mockRegister.mockResolvedValue({ ok: false, error: 'Bad request' });

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });
  });

  describe('Loading state during submission', () => {
    it('disables submit button while submitting', async () => {
      let resolve: (v: any) => void;
      const pendingPromise = new Promise((r) => { resolve = r; });
      mockRegister.mockReturnValue(pendingPromise);

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
      });

      // Resolve the promise to avoid dangling state
      resolve!({ ok: true });
    });

    it('shows "Creating account..." text while submitting', async () => {
      let resolve: (v: any) => void;
      const pendingPromise = new Promise((r) => { resolve = r; });
      mockRegister.mockReturnValue(pendingPromise);

      renderWithProviders(<RegisterPage />);

      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret1234' } });

      fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/creating account\.\.\./i)).toBeInTheDocument();
      });

      resolve!({ ok: true });
    });
  });
});
