import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReservationsPage from '../src/pages/ReservationsPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
  apiPut: (...args: any[]) => mockApiPut(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

const mockUseAuth = vi.fn();
vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

// ── Mock useNavigate ───────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

// ── Test data ──────────────────────────────────────────────────────────────────

const now = new Date();

const mockReservations = [
  {
    _id: 'res1',
    roomId: 'Study Pod A',
    zoneId: 'Library Floor 1',
    userId: 'u1',
    startAtUtc: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    endAtUtc: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    status: 'confirmed' as const,
    createdAt: now.toISOString(),
  },
  {
    _id: 'res2',
    roomId: 'Group Room B',
    zoneId: 'Library Floor 1',
    userId: 'u1',
    startAtUtc: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    endAtUtc: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    status: 'completed' as const,
    createdAt: now.toISOString(),
  },
  {
    _id: 'res3',
    roomId: 'Focus Booth C',
    zoneId: 'Library Floor 2',
    userId: 'u1',
    startAtUtc: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    endAtUtc: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
    status: 'canceled' as const,
    createdAt: now.toISOString(),
  },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <BrowserRouter>
      {ui}
    </BrowserRouter>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ReservationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { _id: 'u1', username: 'alice', displayName: 'Alice', roles: [], reputationTier: 'standard', isActive: true },
      loading: false,
      isAdmin: false,
      isCreator: false,
      isModerator: false,
      isStaff: false,
      hasRole: () => false,
    });
  });

  describe('Renders reservation table', () => {
    it('renders reservation rows with room names', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: mockReservations,
        meta: { total: 3, page: 1, pageSize: 10 },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      expect(screen.getByText('Group Room B')).toBeInTheDocument();
      expect(screen.getByText('Focus Booth C')).toBeInTheDocument();
    });

    it('renders status badges', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: mockReservations,
        meta: { total: 3, page: 1, pageSize: 10 },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        // Multiple elements with status label may exist (badge + dropdown option) — use getAllByText
        expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Canceled').length).toBeGreaterThanOrEqual(1);
    });

    it('shows empty state when user has no reservations', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: [],
        meta: { total: 0, page: 1, pageSize: 10 },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('No reservations found')).toBeInTheDocument();
      });
    });

    it('shows error message on fetch failure', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { message: 'Unable to load reservations' },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load reservations')).toBeInTheDocument();
      });
    });

    it('shows loading state initially', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));

      renderWithProviders(<ReservationsPage />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('Status filter', () => {
    it('renders status filter dropdown', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: mockReservations,
        meta: { total: 3, page: 1, pageSize: 10 },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      // The filter dropdown for status should be in the DOM
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('re-fetches reservations when status filter changes', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: mockReservations,
        meta: { total: 3, page: 1, pageSize: 10 },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'confirmed' } });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/reservations',
          expect.objectContaining({ status: 'confirmed' })
        );
      });
    });

    it('shows only confirmed reservations when filter is set to confirmed', async () => {
      const confirmedOnly = [mockReservations[0]];
      let callCount = 0;
      mockApiGet.mockImplementation(() => {
        callCount++;
        // First call (initial load) returns all; subsequent returns filtered
        if (callCount === 1) {
          return Promise.resolve({ ok: true, data: mockReservations, meta: { total: 3, page: 1, pageSize: 10 } });
        }
        return Promise.resolve({ ok: true, data: confirmedOnly, meta: { total: 1, page: 1, pageSize: 10 } });
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      // Apply filter
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'confirmed' } });

      await waitFor(() => {
        // Only the confirmed reservation room name should appear
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      // After filtering, canceled and completed rooms should not be displayed
      await waitFor(() => {
        expect(screen.queryByText('Group Room B')).not.toBeInTheDocument();
      });
    });

    it('shows all statuses in the dropdown options', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: [],
        meta: { total: 0, page: 1, pageSize: 10 },
      });

      renderWithProviders(<ReservationsPage />);

      await waitFor(() => {
        const select = screen.getByRole('combobox');
        expect(select).toBeInTheDocument();
      });

      expect(screen.getByText('Confirmed')).toBeInTheDocument();
      expect(screen.getByText('Checked In')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Canceled')).toBeInTheDocument();
      expect(screen.getByText('No-Show')).toBeInTheDocument();
    });
  });
});
