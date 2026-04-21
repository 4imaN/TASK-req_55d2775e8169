import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MembershipPage from '../../src/pages/admin/MembershipPage';

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

const mockTiers = [
  {
    _id: 'tier1',
    name: 'Bronze',
    description: 'Entry level membership',
    benefits: { maxHoursPerWeek: 5 },
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    _id: 'tier2',
    name: 'Gold',
    description: 'Premium membership',
    benefits: { maxHoursPerWeek: 20, priorityBooking: true },
    version: 2,
    createdAt: '2024-01-15T00:00:00.000Z',
  },
];

const mockMembers = [
  {
    _id: 'm1',
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    tierId: 'tier1',
    tierName: 'Bronze',
    balanceCents: 5000,
    pointsBalance: 120,
    isBlacklisted: false,
    createdAt: '2024-02-01T00:00:00.000Z',
  },
  {
    _id: 'm2',
    userId: 'u2',
    username: 'bob',
    displayName: 'Bob',
    tierId: null,
    tierName: null,
    balanceCents: 0,
    pointsBalance: 0,
    isBlacklisted: true,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/membership/tiers') return Promise.resolve({ ok: true, data: mockTiers });
    if (path === '/membership/members') return Promise.resolve({ ok: true, data: mockMembers, meta: { total: 2 } });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPost.mockResolvedValue({ ok: true });
  mockApiPut.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MembershipPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading', () => {
    it('renders the Membership Management heading', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /membership management/i })).toBeInTheDocument();
      });
    });
  });

  describe('Tiers section', () => {
    it('renders tier cards with names', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        // "Bronze" appears in tier card AND in member table row — use getAllByText
        expect(screen.getAllByText('Bronze').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getAllByText('Gold').length).toBeGreaterThanOrEqual(1);
    });

    it('renders tier descriptions', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('Entry level membership')).toBeInTheDocument();
      });
      expect(screen.getByText('Premium membership')).toBeInTheDocument();
    });

    it('renders New Tier button', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new tier/i })).toBeInTheDocument();
      });
    });

    it('renders Edit buttons for each tier', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        const editButtons = screen.getAllByRole('button', { name: /edit/i });
        expect(editButtons.length).toBe(2);
      });
    });

    it('shows tiers loading spinner', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<MembershipPage />);
      expect(screen.getByText(/loading tiers/i)).toBeInTheDocument();
    });

    it('shows tiers error when fetch fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/membership/tiers') return Promise.resolve({ ok: false, error: { message: 'Tiers unavailable' } });
        return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
      });
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('Tiers unavailable')).toBeInTheDocument();
      });
    });

    it('shows empty state when no tiers exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/membership/tiers') return Promise.resolve({ ok: true, data: [] });
        if (path === '/membership/members') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('No tiers configured.')).toBeInTheDocument();
      });
    });
  });

  describe('New Tier modal', () => {
    it('opens New Tier modal when button is clicked', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new tier/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new tier/i }));

      expect(screen.getByText('New Tier')).toBeInTheDocument();
    });

    it('renders tier form fields in the modal', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new tier/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new tier/i }));

      expect(screen.getByPlaceholderText(/tier name/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/optional description/i)).toBeInTheDocument();
      expect(screen.getByText('Benefits (JSON)')).toBeInTheDocument();
    });

    it('closes modal on Cancel', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new tier/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new tier/i }));
      expect(screen.getByText('New Tier')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByText('New Tier')).not.toBeInTheDocument();
      });
    });

    it('shows validation error when name is empty on submit', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new tier/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new tier/i }));
      fireEvent.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(screen.getByText('Name is required.')).toBeInTheDocument();
      });
    });

    it('calls apiPost when valid tier is submitted', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new tier/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new tier/i }));

      fireEvent.change(screen.getByPlaceholderText(/tier name/i), {
        target: { value: 'Silver' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/membership/tiers',
          expect.objectContaining({ name: 'Silver' })
        );
      });
    });

    it('opens Edit Tier modal with pre-filled data', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        const editButtons = screen.getAllByRole('button', { name: /edit/i });
        expect(editButtons.length).toBeGreaterThan(0);
      });

      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[0]);

      expect(screen.getByText('Edit Tier')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Bronze')).toBeInTheDocument();
    });
  });

  describe('Members section', () => {
    it('renders member rows with display names', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('renders tier name for members with a tier', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        // "Bronze" appears both in tier card (strong) and member table (td)
        expect(screen.getAllByText('Bronze').length).toBeGreaterThanOrEqual(2);
      });
    });

    it('renders balance formatted as currency', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('$50.00')).toBeInTheDocument();
      });
    });

    it('shows Blacklisted badge for blacklisted members', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('Blacklisted')).toBeInTheDocument();
      });
    });

    it('shows Active badge for non-blacklisted members', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    it('renders Assign Tier buttons', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        const assignButtons = screen.getAllByRole('button', { name: /assign tier/i });
        expect(assignButtons.length).toBe(2);
      });
    });

    it('shows members loading spinner', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<MembershipPage />);
      expect(screen.getByText(/loading tiers/i)).toBeInTheDocument();
    });

    it('shows empty state when no members found', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/membership/tiers') return Promise.resolve({ ok: true, data: mockTiers });
        if (path === '/membership/members') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByText('No members found')).toBeInTheDocument();
      });
    });
  });

  describe('Assign Tier modal', () => {
    it('opens Assign Tier modal when button is clicked', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /assign tier/i }).length).toBeGreaterThan(0);
      });

      const assignButtons = screen.getAllByRole('button', { name: /assign tier/i });
      fireEvent.click(assignButtons[0]);

      // The modal heading includes "Assign Tier — Alice"
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /assign tier/i })).toBeInTheDocument();
      });
      expect(screen.getByText('Select Tier')).toBeInTheDocument();
    });

    it('calls apiPut when Assign is clicked', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /assign tier/i }).length).toBeGreaterThan(0);
      });

      const assignButtons = screen.getAllByRole('button', { name: /assign tier/i });
      fireEvent.click(assignButtons[0]);

      fireEvent.click(screen.getByRole('button', { name: /^assign$/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/membership/assign',
          expect.objectContaining({ userId: expect.any(String) })
        );
      });
    });

    it('shows success message after assigning tier', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /assign tier/i }).length).toBeGreaterThan(0);
      });

      const assignButtons = screen.getAllByRole('button', { name: /assign tier/i });
      fireEvent.click(assignButtons[0]);

      fireEvent.click(screen.getByRole('button', { name: /^assign$/i }));

      await waitFor(() => {
        expect(screen.getByText('Tier assigned.')).toBeInTheDocument();
      });
    });
  });

  describe('Search', () => {
    it('renders the member search input', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/username or display name/i)).toBeInTheDocument();
      });
    });

    it('calls apiGet with search param when query is entered', async () => {
      renderWithRouter(<MembershipPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/username or display name/i)).toBeInTheDocument();
      });

      mockApiGet.mockClear();
      fireEvent.change(screen.getByPlaceholderText(/username or display name/i), {
        target: { value: 'alice' },
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/membership/members',
          expect.objectContaining({ search: 'alice' })
        );
      });
    });
  });
});
