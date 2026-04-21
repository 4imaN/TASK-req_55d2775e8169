import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ExportsPage from '../../src/pages/admin/ExportsPage';

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

const mockExports = [
  {
    _id: 'ex1',
    exportType: 'reservations',
    status: 'completed' as const,
    filePath: '/tmp/ex1.csv',
    fileHash: 'abc123',
    createdAt: '2024-04-01T10:00:00.000Z',
    completedAt: '2024-04-01T10:01:00.000Z',
  },
  {
    _id: 'ex2',
    exportType: 'leads',
    status: 'running' as const,
    createdAt: '2024-04-01T11:00:00.000Z',
  },
  {
    _id: 'ex3',
    exportType: 'ledger',
    status: 'failed' as const,
    errorMessage: 'Timeout exceeded',
    createdAt: '2024-04-01T09:00:00.000Z',
  },
  {
    _id: 'ex4',
    exportType: 'analytics',
    status: 'queued' as const,
    createdAt: '2024-04-01T12:00:00.000Z',
  },
];

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ExportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use real timers so waitFor works correctly with the polling/setTimeout in ExportsPage
    vi.useRealTimers();
    mockApiGet.mockResolvedValue({ ok: true, data: mockExports });
    mockApiPost.mockResolvedValue({ ok: true, data: { _id: 'new-ex', exportType: 'reservations', status: 'queued', createdAt: new Date().toISOString() } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Page heading and form', () => {
    it('renders the Data Exports heading', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /data exports/i })).toBeInTheDocument();
      });
    });

    it('renders the New Export section heading', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /new export/i })).toBeInTheDocument();
      });
    });

    it('renders Export Type select with all types', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /data exports/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('option', { name: /reservations/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /attendance/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /leads/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /ledger/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /analytics/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /policy impact/i })).toBeInTheDocument();
    });

    it('renders Zone ID and Room ID optional inputs', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/zone id/i)).toBeInTheDocument();
      });
      expect(screen.getByPlaceholderText(/room id/i)).toBeInTheDocument();
    });

    it('renders the Create Export submit button', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create export/i })).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching exports', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<ExportsPage />);
      expect(screen.getByText(/loading exports/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<ExportsPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no exports exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText(/no exports yet/i)).toBeInTheDocument();
      });
    });

    it('shows helpful message about creating an export in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText(/create an export job using the form above/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Server unavailable' } });
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Server unavailable')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message is provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load exports')).toBeInTheDocument();
      });
    });
  });

  describe('Export list rendering', () => {
    it('renders Export Jobs section heading after loading', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Export Jobs')).toBeInTheDocument();
      });
    });

    it('renders a Completed status badge', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        // "Completed" appears as a status badge AND as a column header
        expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(2);
      });
    });

    it('renders a Running status badge', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Running')).toBeInTheDocument();
      });
    });

    it('renders a Failed status badge', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument();
      });
    });

    it('renders a Queued status badge', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Queued')).toBeInTheDocument();
      });
    });

    it('renders a Download link for completed exports', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument();
      });
    });

    it('shows export type labels in the table', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        // "Leads" appears in both the select option and table badge
        expect(screen.getAllByText('Leads').length).toBeGreaterThanOrEqual(2);
      });
      // "Ledger" and "Analytics" also appear in both select and table
      expect(screen.getAllByText('Ledger').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('Analytics').length).toBeGreaterThanOrEqual(2);
    });

    it('shows error message for failed exports', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Timeout exceeded')).toBeInTheDocument();
      });
    });

    it('renders table column headers', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByText('Type')).toBeInTheDocument();
      });
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Created')).toBeInTheDocument();
      // "Completed" appears both as a column header AND as a status badge
      expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(2);
      // "Download" appears as column header AND as a link for completed exports
      expect(screen.getAllByText('Download').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Create Export form submission', () => {
    it('calls apiPost when Create Export is submitted', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create export/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create export/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/exports',
          expect.objectContaining({ exportType: 'reservations' })
        );
      });
    });

    it('shows success message after export creation', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create export/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create export/i }));

      await waitFor(() => {
        expect(screen.getByText(/export job created/i)).toBeInTheDocument();
      });
    });

    it('shows form error when apiPost fails', async () => {
      mockApiPost.mockResolvedValue({ ok: false, error: { message: 'Export limit reached' } });
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create export/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create export/i }));

      await waitFor(() => {
        expect(screen.getByText('Export limit reached')).toBeInTheDocument();
      });
    });

    it('includes zone filter in post body when Zone ID is filled', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/zone id/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/zone id/i), { target: { value: 'zone-abc' } });
      fireEvent.click(screen.getByRole('button', { name: /create export/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/exports',
          expect.objectContaining({ filters: expect.objectContaining({ zoneId: 'zone-abc' }) })
        );
      });
    });

    it('changes export type via select before submitting', async () => {
      renderWithRouter(<ExportsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create export/i })).toBeInTheDocument();
      });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'attendance' } });
      fireEvent.click(screen.getByRole('button', { name: /create export/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/exports',
          expect.objectContaining({ exportType: 'attendance' })
        );
      });
    });
  });
});
