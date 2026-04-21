import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RoomSetupPage from '../../src/pages/staff/RoomSetupPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();

vi.mock('../../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
  apiPut: (...args: any[]) => mockApiPut(...args),
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
  {
    _id: 'r1',
    zoneId: 'z1',
    name: 'Room 101',
    description: 'A quiet study room',
    capacity: 4,
    amenities: ['wifi', 'whiteboard'],
    isActive: true,
    version: 1,
  },
  {
    _id: 'r2',
    zoneId: 'z2',
    name: 'Conference Hall',
    description: '',
    capacity: 20,
    amenities: [],
    isActive: false,
    version: 2,
  },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
    if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms, meta: { total: 2 } });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPost.mockResolvedValue({ ok: true });
  mockApiPut.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RoomSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading and controls', () => {
    it('renders the Room Setup heading', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /room setup/i })).toBeInTheDocument();
      });
    });

    it('renders the Create Room button', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });
    });

    it('renders zone filter dropdown with All Zones option', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /all zones/i })).toBeInTheDocument();
      });
    });

    it('renders zone options in zone filter', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Zone Alpha' })).toBeInTheDocument();
      });
      expect(screen.getByRole('option', { name: 'Zone Beta' })).toBeInTheDocument();
    });

    it('disables Create Room button when no zones are loaded', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [] });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeDisabled();
      });
    });

    it('shows warning when no zones exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [] });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText(/create a zone first/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching rooms', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<RoomSetupPage />);
      expect(screen.getByText(/loading rooms/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<RoomSetupPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no rooms exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText(/no rooms found/i)).toBeInTheDocument();
      });
    });

    it('shows helpful message in empty state', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText(/create rooms to start accepting reservations/i)).toBeInTheDocument();
      });
    });
  });

  describe('Room table rendering', () => {
    it('renders room names in table', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('Room 101')).toBeInTheDocument();
      });
      expect(screen.getByText('Conference Hall')).toBeInTheDocument();
    });

    it('renders zone names resolved from zone id', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        // "Zone Alpha" appears in filter dropdown option AND in the table cell
        expect(screen.getAllByText('Zone Alpha').length).toBeGreaterThanOrEqual(2);
      });
      expect(screen.getAllByText('Zone Beta').length).toBeGreaterThanOrEqual(1);
    });

    it('renders capacity for rooms', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('4')).toBeInTheDocument();
      });
      expect(screen.getByText('20')).toBeInTheDocument();
    });

    it('renders amenities as comma-separated list', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('wifi, whiteboard')).toBeInTheDocument();
      });
    });

    it('renders Active badge for active rooms', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    it('renders Inactive badge for inactive rooms', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
      });
    });

    it('renders Edit buttons for each room', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        expect(editButtons.length).toBe(2);
      });
    });

    it('renders table column headers', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('Name')).toBeInTheDocument();
      });
      // "Zone" appears as filter label AND table header - use getAllByText
      expect(screen.getAllByText('Zone').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Capacity')).toBeInTheDocument();
      expect(screen.getByText('Amenities')).toBeInTheDocument();
      // "Status" appears as filter label and table header
      expect(screen.getAllByText('Status').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  describe('Create Room modal', () => {
    it('opens Create Room modal when button is clicked', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));

      await waitFor(() => {
        expect(screen.getByText('Create Room', { selector: 'h2' })).toBeInTheDocument();
      });
    });

    it('renders room name input in modal', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));

      expect(screen.getByText('Room Name')).toBeInTheDocument();
    });

    it('renders Amenities input with placeholder', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));

      expect(screen.getByPlaceholderText(/wifi, power_outlets/i)).toBeInTheDocument();
    });

    it('renders Zone select in create modal', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));

      // Zone select inside modal should show zone options
      expect(screen.getAllByRole('option', { name: 'Zone Alpha' }).length).toBeGreaterThanOrEqual(1);
    });

    it('closes modal when Cancel is clicked', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));
      expect(screen.getByRole('heading', { name: /^create room$/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /^create room$/i })).not.toBeInTheDocument();
      });
    });

    it('calls apiPost when create form is submitted', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));

      // Fill in room name
      const nameInputs = screen.getAllByRole('textbox');
      const roomNameInput = nameInputs.find((inp) => {
        const label = inp.closest('.form-group')?.querySelector('label');
        return label?.textContent?.includes('Room Name');
      });
      if (roomNameInput) {
        fireEvent.change(roomNameInput, { target: { value: 'New Study Room' } });
      }

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/rooms',
          expect.objectContaining({ name: 'New Study Room' })
        );
      });
    });

    it('shows form error when apiPost fails', async () => {
      mockApiPost.mockResolvedValue({ ok: false, error: { message: 'Room name taken' } });
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create room/i }));

      const nameInputs = screen.getAllByRole('textbox');
      const roomNameInput = nameInputs.find((inp) => {
        const label = inp.closest('.form-group')?.querySelector('label');
        return label?.textContent?.includes('Room Name');
      });
      if (roomNameInput) {
        fireEvent.change(roomNameInput, { target: { value: 'Room 101' } });
      }

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.getByText('Room name taken')).toBeInTheDocument();
      });
    });
  });

  describe('Edit Room modal', () => {
    it('opens Edit Room modal with pre-filled data when Edit is clicked', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        expect(editButtons.length).toBeGreaterThan(0);
      });

      const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
      fireEvent.click(editButtons[0]);

      expect(screen.getByRole('heading', { name: /^edit room$/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue('Room 101')).toBeInTheDocument();
    });

    it('shows Active checkbox in edit modal', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('does not show Zone select in edit modal', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      // In edit mode, zone select label "Zone" should NOT appear inside the modal form
      // (it still appears in the table header and filter, but not as a form label)
      // Check that no <label> with text "Zone" is present in the modal
      const zoneLabels = document.querySelectorAll('.modal label');
      const hasZoneLabel = Array.from(zoneLabels).some((el) => el.textContent === 'Zone');
      expect(hasZoneLabel).toBe(false);
    });

    it('calls apiPut when edit form is saved', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      // Modify room name
      const displayValueInput = screen.getByDisplayValue('Room 101');
      fireEvent.change(displayValueInput, { target: { value: 'Room 101 Updated' } });

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          expect.stringContaining('/rooms/r1'),
          expect.objectContaining({ name: 'Room 101 Updated' })
        );
      });
    });
  });

  describe('Pagination', () => {
    it('does not render pagination when total <= 20', async () => {
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('Room 101')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /prev/i })).not.toBeInTheDocument();
    });

    it('renders pagination when total > 20', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms, meta: { total: 45 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<RoomSetupPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });
});
