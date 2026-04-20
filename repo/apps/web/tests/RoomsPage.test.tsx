import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RoomsPage from '../src/pages/RoomsPage';
import { AuthProvider } from '../src/contexts/AuthContext';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
  apiDelete: (...args: any[]) => mockApiDelete(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

const mockUseAuth = vi.fn();
vi.mock('../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const mockZones = [
  { _id: 'zone1', name: 'Library Floor 1', isActive: true },
  { _id: 'zone2', name: 'Library Floor 2', isActive: true },
];

const mockRooms = [
  {
    _id: 'room1',
    zoneId: 'zone1',
    name: 'Study Pod A',
    description: 'A quiet study pod',
    capacity: 2,
    amenities: ['whiteboard', 'projector'],
    isActive: true,
  },
  {
    _id: 'room2',
    zoneId: 'zone2',
    name: 'Group Room B',
    description: 'A larger group room',
    capacity: 8,
    amenities: ['tv_screen'],
    isActive: true,
  },
  {
    _id: 'room3',
    zoneId: 'zone1',
    name: 'Focus Booth C',
    description: null,
    capacity: 1,
    amenities: [],
    isActive: false,
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

describe('RoomsPage', () => {
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

  describe('Render room list with zone filter', () => {
    it('renders room cards when rooms are loaded', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms, meta: { total: 3 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      expect(screen.getByText('Group Room B')).toBeInTheDocument();
      expect(screen.getByText('Focus Booth C')).toBeInTheDocument();
    });

    it('renders zone filter dropdown with zone options', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms, meta: { total: 3 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        // Zone names appear both in the dropdown AND on room cards — use getAllByText
        expect(screen.getAllByText('Library Floor 1').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getAllByText('Library Floor 2').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('All Zones')).toBeInTheDocument();
    });

    it('filters rooms by zone selection', async () => {
      mockApiGet.mockImplementation((path: string, params: any) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') {
          if (params?.zoneId === 'zone1') {
            return Promise.resolve({
              ok: true,
              data: mockRooms.filter((r) => r.zoneId === 'zone1'),
              meta: { total: 2 },
            });
          }
          return Promise.resolve({ ok: true, data: mockRooms, meta: { total: 3 } });
        }
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      // The zone filter is a <select> element — use role 'combobox'
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'zone1' } });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/rooms',
          expect.objectContaining({ zoneId: 'zone1' })
        );
      });
    });

    it('shows total room count', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms, meta: { total: 3 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText(/3 rooms available/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while rooms are being fetched', () => {
      // apiGet never resolves during this test
      mockApiGet.mockImplementation(() => new Promise(() => {}));

      renderWithProviders(<RoomsPage />);

      // Loading state text should be visible
      expect(screen.getByText(/loading rooms/i)).toBeInTheDocument();
    });

    it('shows a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));

      const { container } = renderWithProviders(<RoomsPage />);

      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state message when no rooms exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText('No rooms found')).toBeInTheDocument();
      });
    });

    it('shows zone-specific empty state when filter is active', async () => {
      mockApiGet.mockImplementation((path: string, params: any) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText('No rooms found')).toBeInTheDocument();
      });

      // Trigger zone filter via the combobox
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'zone1' } });

      await waitFor(() => {
        expect(screen.getByText(/no rooms in this zone/i)).toBeInTheDocument();
      });
    });

    it('shows error message when rooms fetch fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        if (path === '/rooms') return Promise.resolve({ ok: false, error: { message: 'Server unavailable' } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText('Server unavailable')).toBeInTheDocument();
      });
    });
  });

  describe('Room card details', () => {
    it('shows amenity badges on room cards', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [mockRooms[0]], meta: { total: 1 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        expect(screen.getByText('Whiteboard')).toBeInTheDocument();
      });
      expect(screen.getByText('Projector')).toBeInTheDocument();
    });

    it('shows capacity information', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones, meta: { total: 2 } });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [mockRooms[0]], meta: { total: 1 } });
        if (path === '/favorites') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });

      renderWithProviders(<RoomsPage />);

      await waitFor(() => {
        // Capacity: 2 persons
        expect(screen.getByText(/2 person/i)).toBeInTheDocument();
      });
    });
  });
});
