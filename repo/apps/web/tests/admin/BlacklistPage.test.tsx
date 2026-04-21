import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BlacklistPage from '../../src/pages/admin/BlacklistPage';

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

const mockActions = [
  {
    _id: 'bl1',
    userId: { _id: 'u1', displayName: 'Alice', username: 'alice' },
    reason: 'Repeated policy violations',
    triggeredBy: 'administrator',
    createdAt: '2024-06-10T10:00:00.000Z',
    expiresAt: '2024-12-31T23:59:59.000Z',
    clearedAt: undefined,
    clearedBy: undefined,
  },
  {
    _id: 'bl2',
    userId: { _id: 'u2', displayName: 'Bob', username: 'bob' },
    reason: 'Abusive behaviour',
    triggeredBy: 'system',
    createdAt: '2024-05-01T08:00:00.000Z',
    expiresAt: undefined,
    clearedAt: '2024-06-01T09:00:00.000Z',
    clearedBy: { displayName: 'Alice' },
  },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/blacklist') return Promise.resolve({ ok: true, data: mockActions, meta: { total: 2 } });
    if (path === '/users') return Promise.resolve({ ok: true, data: [
      { _id: 'u3', displayName: 'Charlie', username: 'charlie' },
    ] });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPost.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BlacklistPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading', () => {
    it('renders the Blacklist Controls heading', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /blacklist controls/i })).toBeInTheDocument();
      });
    });

    it('renders the Blacklist User button', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading text while fetching blacklist', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<BlacklistPage />);
      expect(screen.getByText(/loading blacklist/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<BlacklistPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no blacklist entries exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/blacklist') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('No blacklist entries')).toBeInTheDocument();
      });
      expect(screen.getByText('No users are currently blacklisted.')).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/blacklist') return Promise.resolve({ ok: false, error: { message: 'Access denied' } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });
  });

  describe('Blacklist table', () => {
    it('renders table column headers', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('User')).toBeInTheDocument();
      });
      expect(screen.getByText('Reason')).toBeInTheDocument();
      expect(screen.getByText('Triggered By')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText('Expires')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders user display names in rows', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('renders reason text in rows', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('Repeated policy violations')).toBeInTheDocument();
      });
      expect(screen.getByText('Abusive behaviour')).toBeInTheDocument();
    });

    it('shows Active badge for non-cleared entries', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    it('shows Cleared badge for cleared entries', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText(/cleared/i)).toBeInTheDocument();
      });
    });

    it('renders Clear button only for non-cleared entries', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        const clearButtons = screen.getAllByRole('button', { name: /^clear$/i });
        // Only one entry is non-cleared (bl1)
        expect(clearButtons.length).toBe(1);
      });
    });

    it('calls apiPost to clear a blacklist entry when Clear is clicked', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^clear$/i }).length).toBe(1);
      });

      fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('/blacklist/u1/clear');
      });
    });

    it('shows success message after clearing an entry', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^clear$/i }).length).toBe(1);
      });

      fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

      await waitFor(() => {
        expect(screen.getByText(/blacklist entry cleared/i)).toBeInTheDocument();
      });
    });
  });

  describe('Blacklist Form modal', () => {
    it('opens the Blacklist User modal when button is clicked', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ blacklist user/i }));

      expect(screen.getByRole('heading', { name: /blacklist user/i })).toBeInTheDocument();
    });

    it('renders user search input in modal', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ blacklist user/i }));

      expect(screen.getByPlaceholderText(/search by username/i)).toBeInTheDocument();
    });

    it('renders Reason textarea in modal', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ blacklist user/i }));

      expect(screen.getByPlaceholderText(/why is this user being blacklisted/i)).toBeInTheDocument();
    });

    it('closes modal on Cancel', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ blacklist user/i }));
      expect(screen.getByRole('heading', { name: /blacklist user/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /blacklist user/i })).not.toBeInTheDocument();
      });
    });

    it('shows validation error when no user is selected on submit', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ blacklist user/i }));

      fireEvent.click(screen.getByRole('button', { name: /confirm blacklist/i }));

      await waitFor(() => {
        expect(screen.getByText('Select a user.')).toBeInTheDocument();
      });
    });

    it('shows search results dropdown when user types in search field', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ blacklist user/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ blacklist user/i }));

      fireEvent.change(screen.getByPlaceholderText(/search by username/i), {
        target: { value: 'charlie' },
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/users',
          expect.objectContaining({ search: 'charlie' })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('@charlie')).toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('does not render pagination when total <= 20', async () => {
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });
      expect(screen.queryByText(/page 1 of/i)).not.toBeInTheDocument();
    });

    it('renders pagination when total > 20', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/blacklist') return Promise.resolve({ ok: true, data: mockActions, meta: { total: 45 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<BlacklistPage />);
      await waitFor(() => {
        expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      });
    });
  });
});
