import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import UsersPage from '../../src/pages/admin/UsersPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();

vi.mock('../../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPut: (...args: any[]) => mockApiPut(...args),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const mockUsers = [
  {
    _id: 'u1',
    username: 'alice',
    displayName: 'Alice Admin',
    roles: ['administrator'],
    reputationTier: 'gold',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    _id: 'u2',
    username: 'bob',
    displayName: 'Bob Mod',
    roles: ['moderator'],
    reputationTier: 'standard',
    isActive: true,
    createdAt: '2024-02-01T00:00:00.000Z',
  },
  {
    _id: 'u3',
    username: 'charlie',
    displayName: 'Charlie User',
    roles: [],
    reputationTier: 'standard',
    isActive: false,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
];

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ ok: true, data: mockUsers, meta: { total: 3 } });
    mockApiPut.mockResolvedValue({ ok: true });
  });

  describe('Page heading and user list', () => {
    it('renders the Users heading', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
      });
    });

    it('shows total user count after loading', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText(/3 total users/i)).toBeInTheDocument();
      });
    });

    it('renders a row for each user', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });
      expect(screen.getByText('Bob Mod')).toBeInTheDocument();
      expect(screen.getByText('Charlie User')).toBeInTheDocument();
    });

    it('renders @username in table rows', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('@alice')).toBeInTheDocument();
      });
      expect(screen.getByText('@bob')).toBeInTheDocument();
    });

    it('shows active/inactive status badges', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        const activeBadges = screen.getAllByText('Active');
        expect(activeBadges.length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('shows role badges for users with roles', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('administrator')).toBeInTheDocument();
      });
      expect(screen.getByText('moderator')).toBeInTheDocument();
    });

    it('shows "none" when user has no roles', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('none')).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<UsersPage />);
      expect(screen.getByText(/loading users/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<UsersPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no users exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [], meta: { total: 0 } });
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('No users found')).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Unauthorized' } });
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Unauthorized')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load users')).toBeInTheDocument();
      });
    });
  });

  describe('Roles modal', () => {
    it('opens role assignment modal when Roles button is clicked', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[0]);

      expect(screen.getByText('Assign Roles')).toBeInTheDocument();
    });

    it('displays current user info inside the modal', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[0]);

      // The modal paragraph shows "User: Alice Admin (@alice)"
      expect(screen.getByText(/assign roles/i)).toBeInTheDocument();
      // Use getAllByText because @alice also appears in the table row
      const aliceRefs = screen.getAllByText(/@alice/i);
      expect(aliceRefs.length).toBeGreaterThanOrEqual(1);
    });

    it('shows all role checkboxes in modal', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[0]);

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(3); // creator, moderator, administrator
    });

    it('closes modal when Cancel is clicked', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[0]);

      expect(screen.getByText('Assign Roles')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText('Assign Roles')).not.toBeInTheDocument();
      });
    });

    it('calls apiPut with updated roles when Save Roles is clicked', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Bob Mod')).toBeInTheDocument();
      });

      // Open modal for Bob (no roles initially — use index 1 for Bob)
      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('Assign Roles')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /save roles/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          expect.stringContaining('/users/'),
          expect.objectContaining({ roles: expect.any(Array) })
        );
      });
    });

    it('shows success message after saving roles', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[0]);

      fireEvent.click(screen.getByRole('button', { name: /save roles/i }));

      await waitFor(() => {
        expect(screen.getByText(/roles updated successfully/i)).toBeInTheDocument();
      });
    });

    it('shows error in modal when apiPut fails', async () => {
      mockApiPut.mockResolvedValue({ ok: false, error: { message: 'Permission denied' } });
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      const roleButtons = screen.getAllByRole('button', { name: /roles/i });
      fireEvent.click(roleButtons[0]);

      fireEvent.click(screen.getByRole('button', { name: /save roles/i }));

      await waitFor(() => {
        expect(screen.getByText('Permission denied')).toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('does not render pagination when total <= 20', async () => {
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });
      expect(screen.queryByText('Prev')).not.toBeInTheDocument();
    });

    it('renders pagination controls when total > 20', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockUsers, meta: { total: 42 } });
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('disables Prev button on first page', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockUsers, meta: { total: 42 } });
      renderWithRouter(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
      });
    });
  });
});
