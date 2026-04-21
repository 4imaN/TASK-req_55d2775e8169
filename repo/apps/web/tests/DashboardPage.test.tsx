import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DashboardPage from '../src/pages/DashboardPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

const mockUseAuth = vi.fn();
vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <BrowserRouter>
      {ui}
    </BrowserRouter>
  );
}

const baseUser = {
  _id: 'u1',
  username: 'alice',
  displayName: 'Alice Liddell',
  roles: [] as string[],
  reputationTier: 'standard',
  isActive: true,
};

const baseAuth = {
  user: baseUser,
  loading: false,
  isAdmin: false,
  isCreator: false,
  isModerator: false,
  isStaff: false,
  hasRole: () => false,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(baseAuth);
    // Default: no unread notifications
    mockApiGet.mockResolvedValue({ ok: true, data: { count: 0 } });
  });

  describe('Renders without crash', () => {
    it('renders the greeting heading', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        // Greeting contains the user's first name
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });
    });

    it('renders the user first name in greeting', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        const matches = screen.getAllByText(/Alice/);
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('falls back to username when displayName is absent', async () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        user: { ...baseUser, displayName: '' },
      });

      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        const matches = screen.getAllByText(/alice/i);
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Quick-action links', () => {
    it('renders Browse Rooms link', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText(/browse rooms/i).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders My Reservations link', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText(/my reservations/i).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders Submit Lead link', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText(/submit lead|lead requests/i).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders Favorites card', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Favorites')).toBeInTheDocument();
      });
    });

    it('renders Notifications card', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeInTheDocument();
      });
    });

    it('renders Reviews & Q&A card', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/reviews/i)).toBeInTheDocument();
      });
    });
  });

  describe('Unread notification badge', () => {
    it('does not show notification quick-action button when unread count is 0', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: { count: 0 } });
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        // The notification quick-action button only appears when count > 0
        expect(screen.queryByText(/\d+ notification/i)).not.toBeInTheDocument();
      });
    });

    it('shows notification quick-action button when there are unread notifications', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: { count: 3 } });
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/3 notification/i)).toBeInTheDocument();
      });
    });

    it('displays singular "Notification" when count is 1', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: { count: 1 } });
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        // "1 Notification" not "1 Notifications"
        expect(screen.getByText(/1 notification(?!s)/i)).toBeInTheDocument();
      });
    });

    it('shows badge on Notifications card when unread count > 0', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: { count: 5 } });
      const { container } = renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        // A badge element with the count exists inside the Notifications card heading
        expect(container.querySelector('.badge-danger')).toBeInTheDocument();
      });
    });
  });

  describe('Profile card', () => {
    it('renders the user display name in the profile card', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        // displayName appears at least once in the profile section
        expect(screen.getAllByText('Alice Liddell').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders the username with @ prefix', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('@alice')).toBeInTheDocument();
      });
    });

    it('renders reputation tier badge', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/standard/i)).toBeInTheDocument();
      });
    });

    it('renders initials avatar from display name', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        // Initials for "Alice Liddell" = "AL"
        expect(screen.getByText('AL')).toBeInTheDocument();
      });
    });
  });

  describe('Staff tools section', () => {
    it('does not render Staff Tools for regular users', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.queryByText('Staff Tools')).not.toBeInTheDocument();
      });
    });

    it('renders Staff Tools card for staff users', async () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        user: { ...baseUser, roles: ['moderator'] },
        isStaff: true,
        isModerator: true,
      });

      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Staff Tools')).toBeInTheDocument();
      });
    });

    it('renders Zone Management link for staff', async () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        user: { ...baseUser, roles: ['moderator'] },
        isStaff: true,
        isModerator: true,
      });

      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Zone Management')).toBeInTheDocument();
      });
    });
  });

  describe('Admin section', () => {
    it('does not render Administration for non-admin users', async () => {
      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.queryByText('Administration')).not.toBeInTheDocument();
      });
    });

    it('renders Administration card for admins', async () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        user: { ...baseUser, roles: ['administrator'] },
        isAdmin: true,
        isStaff: true,
        hasRole: () => true,
      });

      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Administration')).toBeInTheDocument();
      });
    });

    it('renders Analytics and Audit Logs links for admins', async () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        user: { ...baseUser, roles: ['administrator'] },
        isAdmin: true,
        isStaff: true,
        hasRole: () => true,
      });

      renderWithProviders(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Analytics')).toBeInTheDocument();
        expect(screen.getByText('Audit Logs')).toBeInTheDocument();
      });
    });
  });
});
