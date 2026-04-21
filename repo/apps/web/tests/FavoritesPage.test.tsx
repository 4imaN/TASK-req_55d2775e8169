import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FavoritesPage from '../src/pages/FavoritesPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiDelete: (...args: any[]) => mockApiDelete(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockNavigate = vi.fn();

// ── Test data ──────────────────────────────────────────────────────────────────

const mockFavorites = [
  {
    _id: 'fav1',
    roomId: 'room1',
    createdAt: new Date().toISOString(),
    room: {
      _id: 'room1',
      name: 'Study Pod A',
      zoneId: { _id: 'zone1', name: 'Library Floor 1' },
      capacity: 2,
      amenities: ['whiteboard', 'projector'],
      isActive: true,
      description: 'A quiet individual pod',
    },
  },
  {
    _id: 'fav2',
    roomId: 'room2',
    createdAt: new Date().toISOString(),
    room: {
      _id: 'room2',
      name: 'Group Room B',
      zoneId: { _id: 'zone2', name: 'Library Floor 2' },
      capacity: 8,
      amenities: ['tv_screen'],
      isActive: false,
      description: null,
    },
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

describe('FavoritesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading state', () => {
    it('shows loading spinner while favorites are being fetched', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithProviders(<FavoritesPage />);

      expect(screen.getByText(/loading favorites/i)).toBeInTheDocument();
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Renders favorite rooms', () => {
    it('renders favorite room cards once loaded', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockFavorites });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      expect(screen.getByText('Group Room B')).toBeInTheDocument();
    });

    it('renders page heading', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockFavorites });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /favorite rooms/i })).toBeInTheDocument();
      });
    });

    it('shows zone name on room cards', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockFavorites });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Library Floor 1')).toBeInTheDocument();
        expect(screen.getByText('Library Floor 2')).toBeInTheDocument();
      });
    });

    it('shows capacity on room cards', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockFavorites });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText(/2 person/i)).toBeInTheDocument();
        expect(screen.getByText(/8 persons/i)).toBeInTheDocument();
      });
    });

    it('shows amenity badges on room cards', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockFavorites });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Whiteboard')).toBeInTheDocument();
        expect(screen.getByText('Projector')).toBeInTheDocument();
        expect(screen.getByText('Tv Screen')).toBeInTheDocument();
      });
    });

    it('shows Available badge for active rooms', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Available')).toBeInTheDocument();
      });
    });

    it('shows Inactive badge for inactive rooms', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[1]] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
      });
    });

    it('renders description when present', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('A quiet individual pod')).toBeInTheDocument();
      });
    });

    it('renders Browse Rooms button in header', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockFavorites });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /browse rooms/i })).toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no favorites exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('No favorites yet')).toBeInTheDocument();
      });
    });

    it('shows instructional text in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText(/mark rooms as favorite/i)).toBeInTheDocument();
      });
    });

    it('renders Browse Rooms button in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        // Two Browse Rooms buttons — one in header, one in empty state
        expect(screen.getAllByRole('button', { name: /browse rooms/i }).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Network error' } });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load favorites')).toBeInTheDocument();
      });
    });
  });

  describe('Unfavorite interaction', () => {
    it('calls apiDelete when remove button is clicked', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });
      mockApiDelete.mockResolvedValue({ ok: true });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      const removeBtn = screen.getByTitle('Remove from favorites');
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(mockApiDelete).toHaveBeenCalledWith('/favorites/room1');
      });
    });

    it('removes room card from DOM after successful unfavorite', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });
      mockApiDelete.mockResolvedValue({ ok: true });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Remove from favorites'));

      await waitFor(() => {
        expect(screen.queryByText('Study Pod A')).not.toBeInTheDocument();
      });
    });

    it('shows success message after successful unfavorite', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });
      mockApiDelete.mockResolvedValue({ ok: true });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Remove from favorites'));

      await waitFor(() => {
        expect(screen.getByText('Room removed from favorites.')).toBeInTheDocument();
      });
    });

    it('shows error message when unfavorite fails', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });
      mockApiDelete.mockResolvedValue({ ok: false, error: { message: 'Could not remove favorite' } });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Remove from favorites'));

      await waitFor(() => {
        expect(screen.getByText('Could not remove favorite')).toBeInTheDocument();
      });
    });

    it('navigates to rooms page when View Availability is clicked', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockFavorites[0]] });

      renderWithProviders(<FavoritesPage />);

      await waitFor(() => {
        expect(screen.getByText('Study Pod A')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /view availability/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/rooms?roomId=room1');
    });
  });
});
