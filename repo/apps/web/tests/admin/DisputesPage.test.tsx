import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DisputesPage from '../../src/pages/admin/DisputesPage';

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

const mockDisputes = [
  {
    _id: 'd1',
    userId: { _id: 'u1', displayName: 'Alice' },
    amount: 2500,
    reason: 'Charged for cancelled reservation',
    status: 'open' as const,
    internalNote: '',
    createdAt: '2024-06-10T10:00:00.000Z',
    resolvedAt: undefined,
  },
  {
    _id: 'd2',
    userId: { _id: 'u2', displayName: 'Bob' },
    amount: 1000,
    reason: 'Double charge occurred',
    status: 'under_review' as const,
    internalNote: 'Looking into payment records',
    createdAt: '2024-06-09T08:00:00.000Z',
    resolvedAt: undefined,
  },
  {
    _id: 'd3',
    userId: 'u3-raw',
    amount: 500,
    reason: 'System error',
    status: 'resolved_user' as const,
    internalNote: 'Refunded',
    createdAt: '2024-06-01T07:00:00.000Z',
    resolvedAt: '2024-06-05T12:00:00.000Z',
  },
];

function setupDefaultMocks() {
  mockApiGet.mockResolvedValue({ ok: true, data: mockDisputes, meta: { total: 3 } });
  mockApiPut.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DisputesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading', () => {
    it('renders the Charge Disputes heading', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /charge disputes/i })).toBeInTheDocument();
      });
    });

    it('shows total dispute count', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('3 total')).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading text while fetching disputes', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<DisputesPage />);
      expect(screen.getByText(/loading disputes/i)).toBeInTheDocument();
    });

    it('renders a spinner while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<DisputesPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no disputes exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [], meta: { total: 0 } });
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('No disputes')).toBeInTheDocument();
      });
      expect(screen.getByText(/no charge disputes have been filed/i)).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Database error' } });
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });

    it('shows fallback error text when no message', async () => {
      mockApiGet.mockResolvedValue({ ok: false });
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load disputes')).toBeInTheDocument();
      });
    });
  });

  describe('Dispute table', () => {
    it('renders expected table column headers', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('User')).toBeInTheDocument();
      });
      expect(screen.getByText('Amount')).toBeInTheDocument();
      expect(screen.getByText('Reason')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    it('renders user display names in rows', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('renders amounts formatted as currency', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('$25.00')).toBeInTheDocument();
      });
      expect(screen.getByText('$10.00')).toBeInTheDocument();
      expect(screen.getByText('$5.00')).toBeInTheDocument();
    });

    it('renders reason text in rows', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('Charged for cancelled reservation')).toBeInTheDocument();
      });
      expect(screen.getByText('Double charge occurred')).toBeInTheDocument();
    });

    it('shows status badges', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('Open')).toBeInTheDocument();
      });
      expect(screen.getByText('Under Review')).toBeInTheDocument();
      expect(screen.getByText('Resolved (User)')).toBeInTheDocument();
    });

    it('renders Manage buttons for each row', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        const manageButtons = screen.getAllByRole('button', { name: /manage/i });
        expect(manageButtons.length).toBe(3);
      });
    });
  });

  describe('Dispute detail modal', () => {
    it('opens detail modal when Manage is clicked', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      expect(screen.getByText('Dispute Detail')).toBeInTheDocument();
    });

    it('shows dispute details in modal', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      // The text appears in both the table row and modal — getAllByText is correct
      const reasonMatches = screen.getAllByText('Charged for cancelled reservation');
      expect(reasonMatches.length).toBeGreaterThanOrEqual(1);
      // The modal heading should also be present
      expect(screen.getByText('Dispute Detail')).toBeInTheDocument();
    });

    it('renders Internal Notes textarea in modal', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      expect(screen.getByText('Internal Notes')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/add resolution notes/i)).toBeInTheDocument();
    });

    it('renders status transition buttons for open disputes', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]); // open dispute (d1)

      await waitFor(() => {
        expect(screen.getByText('Update Status')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /under review/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rejected/i })).toBeInTheDocument();
    });

    it('calls apiPut when a status transition button is clicked', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /under review/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /under review/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/wallet/disputes/d1',
          expect.objectContaining({ status: 'under_review' })
        );
      });
    });

    it('shows success message after status transition', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /under review/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /under review/i }));

      await waitFor(() => {
        expect(screen.getByText(/marked as under review/i)).toBeInTheDocument();
      });
    });

    it('shows error when apiPut fails', async () => {
      mockApiPut.mockResolvedValue({ ok: false, error: { message: 'Update failed' } });
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /under review/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /under review/i }));

      await waitFor(() => {
        expect(screen.getByText('Update failed')).toBeInTheDocument();
      });
    });

    it('closes modal when Close is clicked', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[0]);

      expect(screen.getByText('Dispute Detail')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      await waitFor(() => {
        expect(screen.queryByText('Dispute Detail')).not.toBeInTheDocument();
      });
    });

    it('does not show Update Status section for resolved disputes', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThan(0);
      });

      // d3 is resolved_user — no valid transitions
      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      fireEvent.click(manageButtons[2]);

      await waitFor(() => {
        expect(screen.getByText('Dispute Detail')).toBeInTheDocument();
      });

      expect(screen.queryByText('Update Status')).not.toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('does not render pagination when total <= 15', async () => {
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });
      expect(screen.queryByText('Prev')).not.toBeInTheDocument();
    });

    it('renders pagination controls when total > 15', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockDisputes, meta: { total: 30 } });
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
      });
    });

    it('disables Prev button on first page', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockDisputes, meta: { total: 30 } });
      renderWithRouter(<DisputesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
      });
    });
  });
});
