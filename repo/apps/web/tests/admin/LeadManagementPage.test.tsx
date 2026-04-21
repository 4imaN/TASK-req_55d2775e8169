import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LeadManagementPage from '../../src/pages/staff/LeadManagementPage';

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

const mockLeads = [
  {
    _id: 'lead1',
    type: 'group_study',
    requirements: 'Need a room for 10 people on weekends',
    budgetCapCents: 50000,
    status: 'New',
    requesterUserId: { _id: 'u1', displayName: 'Alice Smith' },
    availabilityWindows: [{ start: '2024-05-01T10:00:00Z', end: '2024-05-01T12:00:00Z' }],
    createdAt: '2024-04-01T00:00:00.000Z',
  },
  {
    _id: 'lead2',
    type: 'long_term',
    requirements: 'Monthly room rental for corporate team',
    budgetCapCents: 200000,
    quoteAmountCents: 180000,
    status: 'Quoted',
    requesterUserId: { _id: 'u2', displayName: 'Bob Corp' },
    availabilityWindows: [],
    createdAt: '2024-03-15T00:00:00.000Z',
  },
  {
    _id: 'lead3',
    type: 'group_study',
    requirements: 'Study group for 4 students',
    status: 'Closed',
    closeReason: 'Budget mismatch',
    requesterUserId: 'u3-raw-id',
    availabilityWindows: [],
    createdAt: '2024-02-01T00:00:00.000Z',
  },
];

const mockNotes = [
  {
    _id: 'note1',
    content: 'Spoke with client, they need evening slots.',
    authorUserId: 'staff-u1',
    createdAt: '2024-04-02T10:00:00.000Z',
  },
];

const mockHistory = [
  {
    _id: 'h1',
    fromStatus: 'New',
    toStatus: 'In Discussion',
    note: 'Initial contact made',
    createdAt: '2024-04-01T12:00:00.000Z',
    changedAt: '2024-04-01T12:00:00.000Z',
  },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/leads') return Promise.resolve({ ok: true, data: mockLeads, meta: { total: 3 } });
    if (/\/leads\/.+\/notes/.test(path)) return Promise.resolve({ ok: true, data: mockNotes });
    if (/\/leads\/.+\/attachments/.test(path)) return Promise.resolve({ ok: true, data: [] });
    if (/\/leads\/.+\/history/.test(path)) return Promise.resolve({ ok: true, data: mockHistory });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPost.mockResolvedValue({ ok: true });
  mockApiPut.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LeadManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading and controls', () => {
    it('renders the Lead Management heading', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /lead management/i })).toBeInTheDocument();
      });
    });

    it('renders Table and Kanban view toggle buttons', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^table$/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /^kanban$/i })).toBeInTheDocument();
    });

    it('renders Filter by Status select in table view', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Filter by Status')).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching leads', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<LeadManagementPage />);
      expect(screen.getByText(/loading leads/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<LeadManagementPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no leads exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/leads') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText(/no leads found/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error when fetch fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/leads') return Promise.resolve({ ok: false, error: { message: 'Access denied' } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message provided', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/leads') return Promise.resolve({ ok: false });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load leads')).toBeInTheDocument();
      });
    });
  });

  describe('Lead table rendering', () => {
    it('renders display names from requesterUserId object', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      });
      expect(screen.getByText('Bob Corp')).toBeInTheDocument();
    });

    it('renders raw string requesterUserId when not an object', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('u3-raw-id')).toBeInTheDocument();
      });
    });

    it('renders type badges (Group Study, Long Term)', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Group Study').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText('Long Term')).toBeInTheDocument();
    });

    it('renders status badges for each lead', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        // "New" appears in filter options and as a badge; use getAllByText
        expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(1);
      });
      // "Quoted" also appears in filter dropdown select option
      expect(screen.getAllByText('Quoted').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(1);
    });

    it('renders budget cap formatted as currency', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('$500.00')).toBeInTheDocument();
      });
    });

    it('renders table column headers', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('User')).toBeInTheDocument();
      });
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Requirements')).toBeInTheDocument();
      expect(screen.getByText('Budget')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders Open buttons for each lead', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        const openButtons = screen.getAllByRole('button', { name: /^open$/i });
        expect(openButtons.length).toBe(3);
      });
    });
  });

  describe('Detail modal', () => {
    async function openFirstLead() {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      });
      const openButtons = screen.getAllByRole('button', { name: /^open$/i });
      fireEvent.click(openButtons[0]);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /lead — alice smith/i })).toBeInTheDocument();
      });
    }

    it('opens detail modal when Open is clicked', async () => {
      await openFirstLead();
      expect(screen.getByRole('heading', { name: /lead — alice smith/i })).toBeInTheDocument();
    });

    it('shows lead requirements in modal', async () => {
      await openFirstLead();
      // requirements text appears in both the table row (truncated) and the modal detail
      const reqs = screen.getAllByText('Need a room for 10 people on weekends');
      expect(reqs.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Internal Notes section in modal', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByText('Internal Notes')).toBeInTheDocument();
      });
    });

    it('shows existing notes in the modal', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByText('Spoke with client, they need evening slots.')).toBeInTheDocument();
      });
    });

    it('shows status history when available', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByText('Status History')).toBeInTheDocument();
      });
    });

    it('shows Attachments section in modal', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByText('Attachments')).toBeInTheDocument();
      });
    });

    it('shows note textarea with placeholder', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
      });
    });

    it('shows status transition buttons for New lead', async () => {
      await openFirstLead();
      await waitFor(() => {
        // New -> In Discussion, Closed
        expect(screen.getByRole('button', { name: /in discussion/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /closed/i })).toBeInTheDocument();
    });

    it('closes modal when Close button is clicked', async () => {
      await openFirstLead();
      fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /lead — alice smith/i })).not.toBeInTheDocument();
      });
    });

    it('calls apiPost to add a note when Add is clicked', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/add a note/i), {
        target: { value: 'Follow up tomorrow' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          expect.stringContaining('/leads/lead1/notes'),
          expect.objectContaining({ content: 'Follow up tomorrow' })
        );
      });
    });

    it('calls apiPut for status transition', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /in discussion/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /in discussion/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          expect.stringContaining('/leads/lead1/status'),
          expect.objectContaining({ status: 'In Discussion' })
        );
      });
    });

    it('shows success message after status transition', async () => {
      await openFirstLead();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /in discussion/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /in discussion/i }));

      await waitFor(() => {
        expect(screen.getByText(/status updated to in discussion/i)).toBeInTheDocument();
      });
    });
  });

  describe('Kanban view', () => {
    it('switches to kanban view when Kanban button is clicked', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^kanban$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^kanban$/i }));

      await waitFor(() => {
        // Kanban columns show status badges for all statuses
        const newBadges = screen.getAllByText('New');
        expect(newBadges.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('hides the filter panel in kanban view', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Filter by Status')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^kanban$/i }));

      await waitFor(() => {
        expect(screen.queryByText('Filter by Status')).not.toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('does not show pagination when total <= 20', async () => {
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      });
      expect(screen.queryByText(/prev/i)).not.toBeInTheDocument();
    });

    it('shows pagination when total > 20', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/leads') return Promise.resolve({ ok: true, data: mockLeads, meta: { total: 45 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<LeadManagementPage />);
      await waitFor(() => {
        expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      });
    });
  });
});
