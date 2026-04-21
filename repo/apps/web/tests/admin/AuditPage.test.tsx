import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AuditPage from '../../src/pages/admin/AuditPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();

vi.mock('../../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const mockLogs = [
  {
    _id: 'log1',
    actorUserId: 'aabbccdd1122',
    actorRole: 'administrator',
    action: 'create_room',
    objectType: 'room',
    objectId: 'room001122',
    oldValue: null,
    newValue: { name: 'New Room' },
    reason: 'Initial setup',
    requestId: 'req-111',
    hash: 'abc123',
    createdAt: '2024-06-15T10:30:00.000Z',
  },
  {
    _id: 'log2',
    actorUserId: 'eeff00112233',
    actorRole: 'moderator',
    action: 'ban_user',
    objectType: 'user',
    objectId: 'user998877',
    oldValue: { isActive: true },
    newValue: { isActive: false },
    reason: 'Policy violation',
    requestId: 'req-222',
    hash: 'def456',
    createdAt: '2024-06-14T08:00:00.000Z',
  },
  {
    _id: 'log3',
    actorUserId: '',
    actorRole: '',
    action: 'login',
    objectType: '',
    objectId: '',
    requestId: 'req-333',
    hash: 'ghi789',
    createdAt: '2024-06-13T09:00:00.000Z',
  },
];

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ ok: true, data: mockLogs, meta: { total: 3 } });
  });

  describe('Page heading', () => {
    it('renders the Audit Log heading', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument();
      });
    });

    it('shows the total entry count after loading', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText(/3 total entries/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading text while fetching logs', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<AuditPage />);
      expect(screen.getByText(/loading audit logs/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<AuditPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Access denied' } });
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
    });

    it('shows fallback error text when no message provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load audit logs')).toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no logs exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [], meta: { total: 0 } });
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('No audit logs found')).toBeInTheDocument();
      });
    });

    it('shows the hint message in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [], meta: { total: 0 } });
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText(/system actions will be recorded here/i)).toBeInTheDocument();
      });
    });
  });

  describe('Log table rendering', () => {
    it('renders expected table columns', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('Timestamp')).toBeInTheDocument();
      });
      expect(screen.getByText('Actor')).toBeInTheDocument();
      expect(screen.getByText('Role')).toBeInTheDocument();
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Object')).toBeInTheDocument();
      expect(screen.getByText('Changes')).toBeInTheDocument();
    });

    it('renders action badge for each log entry', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('create_room')).toBeInTheDocument();
      });
      expect(screen.getByText('ban_user')).toBeInTheDocument();
      expect(screen.getByText('login')).toBeInTheDocument();
    });

    it('shows truncated actor user ID', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        // actorUserId 'aabbccdd1122' → last 8 chars = 'ccdd1122'
        expect(screen.getByText('ccdd1122')).toBeInTheDocument();
      });
    });

    it('shows "system" when actorUserId is empty', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('system')).toBeInTheDocument();
      });
    });

    it('shows changes column with detail when old/new values exist', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        // Multiple rows can have newValue in their title tooltip — use getAllByTitle
        const tooltips = screen.getAllByTitle(/newValue/);
        expect(tooltips.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows em-dash when no changes are present', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        // log3 has no old/new/reason so '—' appears
        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Date filter controls', () => {
    it('renders From Date and To Date inputs', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText(/audit log/i)).toBeInTheDocument();
      });
      expect(screen.getByText('From Date')).toBeInTheDocument();
      expect(screen.getByText('To Date')).toBeInTheDocument();
    });

    it('renders Apply button', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
      });
    });

    it('does not show Clear button when no filter is applied', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('shows Clear button after applying a date filter', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
      });

      const dateInputs = screen.getAllByDisplayValue('');
      // Set from date
      fireEvent.change(dateInputs[0], { target: { value: '2024-06-01' } });

      fireEvent.click(screen.getByRole('button', { name: /apply/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
      });
    });

    it('calls apiGet with date params when filter is applied', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
      });

      const dateInputs = screen.getAllByDisplayValue('');
      fireEvent.change(dateInputs[0], { target: { value: '2024-06-01' } });
      fireEvent.change(dateInputs[1], { target: { value: '2024-06-30' } });

      mockApiGet.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /apply/i }));

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/audit-logs',
          expect.objectContaining({ startDate: expect.any(String) })
        );
      });
    });
  });

  describe('Pagination', () => {
    it('does not render pagination when total <= 25', async () => {
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText('create_room')).toBeInTheDocument();
      });
      expect(screen.queryByText('Prev')).not.toBeInTheDocument();
    });

    it('renders pagination controls when total > 25', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockLogs, meta: { total: 75 } });
      renderWithRouter(<AuditPage />);
      await waitFor(() => {
        expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      });
    });
  });
});
