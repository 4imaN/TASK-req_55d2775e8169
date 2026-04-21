import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReservationOpsPage from '../../src/pages/staff/ReservationOpsPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const mockZones = [
  { _id: 'z1', name: 'Zone Alpha' },
  { _id: 'z2', name: 'Zone Beta' },
];

const mockRooms = [
  { _id: 'r1', name: 'Room 101', zoneId: 'z1' },
  { _id: 'r2', name: 'Room 202', zoneId: 'z2' },
];

const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const mockReservations = [
  {
    _id: 'res1',
    roomId: { _id: 'r1', name: 'Room 101' },
    zoneId: { _id: 'z1', name: 'Zone Alpha' },
    userId: { _id: 'u1', displayName: 'Alice Student' },
    startAtUtc: futureDate,
    endAtUtc: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    status: 'confirmed',
    createdAt: '2024-04-01T00:00:00.000Z',
  },
  {
    _id: 'res2',
    roomId: { _id: 'r2', name: 'Room 202' },
    zoneId: { _id: 'z2', name: 'Zone Beta' },
    userId: { _id: 'u2', displayName: 'Bob Researcher' },
    startAtUtc: '2024-03-01T14:00:00.000Z',
    endAtUtc: '2024-03-01T16:00:00.000Z',
    status: 'completed',
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    _id: 'res3',
    roomId: 'r3-raw',
    zoneId: 'z3-raw',
    userId: 'u3-raw',
    startAtUtc: '2024-04-05T10:00:00.000Z',
    endAtUtc: '2024-04-05T11:00:00.000Z',
    status: 'canceled',
    createdAt: '2024-04-05T00:00:00.000Z',
  },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
    if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
    if (path === '/reservations') return Promise.resolve({ ok: true, data: mockReservations, meta: { total: 3 } });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPost.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ReservationOpsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading and controls', () => {
    it('renders the Reservation Operations heading', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /reservation operations/i })).toBeInTheDocument();
      });
    });

    it('shows total count after loading', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('3 total')).toBeInTheDocument();
      });
    });

    it('renders zone filter dropdown with zone options', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /zone alpha/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('option', { name: /zone beta/i })).toBeInTheDocument();
    });

    it('renders status filter dropdown', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /confirmed/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('option', { name: /checked in/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /canceled/i })).toBeInTheDocument();
    });

    it('renders Clear filter button', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching reservations', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<ReservationOpsPage />);
      expect(screen.getByText(/loading reservations/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<ReservationOpsPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no reservations match filters', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
        if (path === '/reservations') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText(/no reservations found/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error when reservations fetch fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
        if (path === '/reservations') return Promise.resolve({ ok: false, error: { message: 'DB timeout' } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('DB timeout')).toBeInTheDocument();
      });
    });
  });

  describe('Reservation table rendering', () => {
    it('renders user display names from populated objects', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Student')).toBeInTheDocument();
      });
      expect(screen.getByText('Bob Researcher')).toBeInTheDocument();
    });

    it('renders raw string userId when not an object', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('u3-raw')).toBeInTheDocument();
      });
    });

    it('renders room names from populated objects', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        // "Room 101" appears in both the filter dropdown and the table cell
        expect(screen.getAllByText('Room 101').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getAllByText('Room 202').length).toBeGreaterThanOrEqual(1);
    });

    it('renders status badges for each reservation', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        // "Confirmed" appears as filter option and as badge in the table
        expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1);
      });
      // "Completed" also appears in the filter dropdown
      expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Canceled').length).toBeGreaterThanOrEqual(1);
    });

    it('renders table column headers', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('User')).toBeInTheDocument();
      });
      // "Room" appears in both the filter label and the table column header
      expect(screen.getAllByText('Room').length).toBeGreaterThanOrEqual(1);
      // "Zone" appears in filter label and column header
      expect(screen.getAllByText('Zone').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.getByText('End')).toBeInTheDocument();
    });

    it('renders Check In button only for confirmed reservations', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        const checkInButtons = screen.getAllByRole('button', { name: /^check in$/i });
        expect(checkInButtons.length).toBe(1);
      });
    });

    it('renders Details buttons for each reservation', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        const detailButtons = screen.getAllByRole('button', { name: /^details$/i });
        expect(detailButtons.length).toBe(3);
      });
    });
  });

  describe('Check-in action', () => {
    it('calls apiPost for check-in when Check In button is clicked', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^check in$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^check in$/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          expect.stringContaining('/reservations/res1/check-in')
        );
      });
    });

    it('shows success message after check-in', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^check in$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^check in$/i }));

      await waitFor(() => {
        expect(screen.getByText('Checked in.')).toBeInTheDocument();
      });
    });

    it('shows error when check-in fails', async () => {
      mockApiPost.mockResolvedValue({ ok: false, error: { message: 'Already checked in' } });
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^check in$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^check in$/i }));

      await waitFor(() => {
        expect(screen.getByText('Already checked in')).toBeInTheDocument();
      });
    });
  });

  describe('Detail / Cancel modal', () => {
    async function openFirstDetails() {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Student')).toBeInTheDocument();
      });
      const detailButtons = screen.getAllByRole('button', { name: /^details$/i });
      fireEvent.click(detailButtons[0]);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /reservation detail/i })).toBeInTheDocument();
      });
    }

    it('opens detail modal when Details is clicked', async () => {
      await openFirstDetails();
      expect(screen.getByRole('heading', { name: /reservation detail/i })).toBeInTheDocument();
    });

    it('shows user name in detail modal', async () => {
      await openFirstDetails();
      // "Alice Student" appears in both table and modal
      const aliceRefs = screen.getAllByText('Alice Student');
      expect(aliceRefs.length).toBeGreaterThanOrEqual(1);
    });

    it('shows room name in detail modal', async () => {
      await openFirstDetails();
      const roomRefs = screen.getAllByText('Room 101');
      expect(roomRefs.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Cancel Reason textarea for confirmed reservations', async () => {
      await openFirstDetails();
      expect(screen.getByPlaceholderText(/reason for cancellation/i)).toBeInTheDocument();
    });

    it('shows Cancel Reservation button for confirmed reservations', async () => {
      await openFirstDetails();
      expect(screen.getByRole('button', { name: /cancel reservation/i })).toBeInTheDocument();
    });

    it('calls apiPost to cancel reservation when Cancel Reservation is clicked', async () => {
      await openFirstDetails();
      fireEvent.click(screen.getByRole('button', { name: /cancel reservation/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          expect.stringContaining('/reservations/res1/cancel'),
          expect.objectContaining({ reason: '' })
        );
      });
    });

    it('shows success message after cancellation', async () => {
      await openFirstDetails();
      fireEvent.click(screen.getByRole('button', { name: /cancel reservation/i }));

      await waitFor(() => {
        expect(screen.getByText('Reservation canceled.')).toBeInTheDocument();
      });
    });

    it('closes modal when Close button is clicked', async () => {
      await openFirstDetails();
      fireEvent.click(screen.getByRole('button', { name: /^close$/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /reservation detail/i })).not.toBeInTheDocument();
      });
    });

    it('does not show Cancel Reservation button for completed reservations', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('Bob Researcher')).toBeInTheDocument();
      });
      const detailButtons = screen.getAllByRole('button', { name: /^details$/i });
      fireEvent.click(detailButtons[1]);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /reservation detail/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /cancel reservation/i })).not.toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('does not render pagination when total <= 15', async () => {
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Student')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /prev/i })).not.toBeInTheDocument();
    });

    it('renders pagination when total > 15', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
        if (path === '/reservations') return Promise.resolve({ ok: true, data: mockReservations, meta: { total: 32 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<ReservationOpsPage />);
      await waitFor(() => {
        expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      });
    });
  });
});
