import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SharedReservationPage from '../src/pages/SharedReservationPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const now = new Date();

const mockSharedReservation = {
  _id: 'res1',
  roomId: 'room1',
  zoneId: 'zone1',
  startAtUtc: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  endAtUtc: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
  status: 'confirmed',
  roomName: 'Study Pod A',
  zoneName: 'Library Floor 1',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Renders SharedReservationPage inside a MemoryRouter with the token
 * param available via :token so useParams() works correctly.
 */
function renderWithToken(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/share/${token}`]}>
      <Routes>
        <Route path="/share/:token" element={<SharedReservationPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Renders without any :token param (blank route). */
function renderWithoutToken() {
  return render(
    <MemoryRouter initialEntries={['/share/']}>
      <Routes>
        <Route path="/share/" element={<SharedReservationPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SharedReservationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching the shared reservation', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithToken('abc123');

      expect(screen.getByText(/loading shared reservation/i)).toBeInTheDocument();
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Renders reservation data', () => {
    it('renders Shared Reservation heading', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /shared reservation/i })).toBeInTheDocument();
      });
    });

    it('renders the room name', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });
    });

    it('renders the zone name', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('Library Floor 1')).toBeInTheDocument();
      });
    });

    it('falls back to roomId when roomName is absent', async () => {
      const noNames = { ...mockSharedReservation, roomName: undefined, zoneName: undefined };
      mockApiGet.mockResolvedValue({ ok: true, data: noNames });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('room1')).toBeInTheDocument();
        expect(screen.getByText('zone1')).toBeInTheDocument();
      });
    });

    it('shows Confirmed status badge for a confirmed reservation', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('Confirmed')).toBeInTheDocument();
      });
    });

    it('shows Canceled badge for a canceled reservation', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: { ...mockSharedReservation, status: 'canceled' },
      });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('Canceled')).toBeInTheDocument();
      });
    });

    it('shows Checked In badge for a checked_in reservation', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: { ...mockSharedReservation, status: 'checked_in' },
      });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('Checked In')).toBeInTheDocument();
      });
    });

    it('shows No-Show badge for expired_no_show status', async () => {
      mockApiGet.mockResolvedValue({
        ok: true,
        data: { ...mockSharedReservation, status: 'expired_no_show' },
      });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText('No-Show')).toBeInTheDocument();
      });
    });

    it('renders "This reservation was shared with you" description', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByText(/this reservation was shared with you/i)).toBeInTheDocument();
      });
    });

    it('renders Book Your Own Room link', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /book your own room/i })).toBeInTheDocument();
      });
    });

    it('calls apiGet with the correct share-links path', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockSharedReservation });

      renderWithToken('abc123');

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/share-links/abc123');
      });
    });
  });

  describe('Not found state', () => {
    it('shows Reservation Not Found heading when error code is NOT_FOUND', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Link not found' },
      });

      renderWithToken('deadlink');

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /reservation not found/i })).toBeInTheDocument();
      });
    });

    it('shows Reservation Not Found heading when error code is GONE', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { code: 'GONE', message: 'Link expired' },
      });

      renderWithToken('expiredtoken');

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /reservation not found/i })).toBeInTheDocument();
      });
    });

    it('shows expiry/revocation hint text in not found state', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'gone' },
      });

      renderWithToken('deadlink');

      await waitFor(() => {
        expect(screen.getByText(/may have expired or been revoked/i)).toBeInTheDocument();
      });
    });

    it('renders My Reservations link in not found state', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'gone' },
      });

      renderWithToken('deadlink');

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /my reservations/i })).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error alert message for non-NOT_FOUND failures', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { code: 'SERVER_ERROR', message: 'Internal server error' },
      });

      renderWithToken('sometoken');

      await waitFor(() => {
        expect(screen.getByText('Internal server error')).toBeInTheDocument();
      });
    });

    it('shows fallback error message when no message provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: {} });

      renderWithToken('sometoken');

      await waitFor(() => {
        expect(screen.getByText('Failed to load shared reservation')).toBeInTheDocument();
      });
    });

    it('renders Go to Dashboard link in error state', async () => {
      mockApiGet.mockResolvedValue({
        ok: false,
        error: { code: 'SERVER_ERROR', message: 'Something went wrong' },
      });

      renderWithToken('sometoken');

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument();
      });
    });

    it('shows error when network call rejects', async () => {
      mockApiGet.mockRejectedValue(new Error('Network failure'));

      renderWithToken('sometoken');

      await waitFor(() => {
        expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
      });
    });
  });
});
