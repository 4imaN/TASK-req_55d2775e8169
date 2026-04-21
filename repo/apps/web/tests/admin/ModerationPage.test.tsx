import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ModerationPage from '../../src/pages/staff/ModerationPage';

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

const mockReports = [
  {
    _id: 'rep1',
    contentType: 'review',
    contentId: 'rev-abc123',
    reporterUserId: { _id: 'u1', displayName: 'Alice' },
    status: 'open' as const,
    reason: 'Inappropriate content',
    createdAt: '2024-06-10T10:00:00.000Z',
  },
  {
    _id: 'rep2',
    contentType: 'user',
    contentId: 'usr-def456',
    reporterUserId: 'u2',
    status: 'under_review' as const,
    reason: 'Spam',
    createdAt: '2024-06-09T08:00:00.000Z',
  },
  {
    _id: 'rep3',
    contentType: 'reservation',
    contentId: 'res-ghi789',
    reporterUserId: { _id: 'u3', displayName: 'Charlie' },
    status: 'dismissed' as const,
    reason: null,
    createdAt: '2024-06-08T07:00:00.000Z',
  },
];

const mockAppeals = [
  {
    _id: 'app1',
    appellantUserId: { _id: 'u1', displayName: 'Alice' },
    reason: 'I did nothing wrong',
    contentType: 'review',
    contentId: 'rev-abc123',
    status: 'submitted' as const,
    createdAt: '2024-06-11T12:00:00.000Z',
  },
  {
    _id: 'app2',
    appellantUserId: 'u4',
    reason: 'Please reconsider',
    contentType: null,
    contentId: null,
    status: 'under_review' as const,
    createdAt: '2024-06-10T11:00:00.000Z',
  },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/moderation/reports') return Promise.resolve({ ok: true, data: mockReports, meta: { total: 3 } });
    if (path === '/moderation/appeals') return Promise.resolve({ ok: true, data: mockAppeals, meta: { total: 2 } });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPut.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ModerationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading and tabs', () => {
    it('renders the Moderation Queue heading', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /moderation queue/i })).toBeInTheDocument();
      });
    });

    it('renders Reports and Appeals tab buttons', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /reports/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /appeals/i })).toBeInTheDocument();
    });

    it('defaults to showing the reports tab', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByText('Inappropriate content')).toBeInTheDocument();
      });
    });
  });

  describe('Reports tab', () => {
    it('renders report table columns', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByText('Type')).toBeInTheDocument();
      });
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Reporter')).toBeInTheDocument();
      expect(screen.getByText('Reason')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders report rows', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
      });
      expect(screen.getByText('Inappropriate content')).toBeInTheDocument();
      expect(screen.getByText('Spam')).toBeInTheDocument();
    });

    it('shows status badges for reports', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByText('Open')).toBeInTheDocument();
      });
      expect(screen.getByText('Under Review')).toBeInTheDocument();
      expect(screen.getByText('Dismissed')).toBeInTheDocument();
    });

    it('shows Review button for open reports', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      });
    });

    it('shows Action and Dismiss buttons for open/under_review reports', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        const actionButtons = screen.getAllByRole('button', { name: /^action$/i });
        const dismissButtons = screen.getAllByRole('button', { name: /dismiss/i });
        expect(actionButtons.length).toBeGreaterThanOrEqual(1);
        expect(dismissButtons.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('calls apiPut when Review button is clicked', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /review/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/moderation/reports/rep1',
          { status: 'under_review' }
        );
      });
    });

    it('shows success message after report action', async () => {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /review/i }));

      await waitFor(() => {
        expect(screen.getByText(/report marked under review/i)).toBeInTheDocument();
      });
    });

    it('shows error when report action fails', async () => {
      mockApiPut.mockResolvedValue({ ok: false, error: { message: 'Not allowed' } });
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /review/i }));

      await waitFor(() => {
        expect(screen.getByText('Not allowed')).toBeInTheDocument();
      });
    });

    it('shows loading state while fetching reports', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<ModerationPage />);
      expect(screen.getByText(/loading reports/i)).toBeInTheDocument();
    });

    it('shows empty state when no reports exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/moderation/reports') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByText('No reports')).toBeInTheDocument();
      });
      expect(screen.getByText(/the moderation queue is clear/i)).toBeInTheDocument();
    });

    it('shows error when reports fetch fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/moderation/reports') return Promise.resolve({ ok: false, error: { message: 'Server error' } });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });
  });

  describe('Appeals tab', () => {
    async function switchToAppeals() {
      renderWithRouter(<ModerationPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /appeals/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /appeals/i }));
    }

    it('switches to appeals tab and fetches appeals data', async () => {
      await switchToAppeals();
      await waitFor(() => {
        expect(screen.getByText('I did nothing wrong')).toBeInTheDocument();
      });
      expect(mockApiGet).toHaveBeenCalledWith(
        '/moderation/appeals',
        expect.objectContaining({ page: '1' })
      );
    });

    it('renders appeals table columns', async () => {
      await switchToAppeals();
      await waitFor(() => {
        expect(screen.getByText('Appellant')).toBeInTheDocument();
      });
      expect(screen.getByText('Reason')).toBeInTheDocument();
    });

    it('shows appeal status badges', async () => {
      await switchToAppeals();
      await waitFor(() => {
        expect(screen.getByText('Submitted')).toBeInTheDocument();
      });
      expect(screen.getByText('Under Review')).toBeInTheDocument();
    });

    it('renders Accept and Deny buttons for actionable appeals', async () => {
      await switchToAppeals();
      await waitFor(() => {
        const acceptButtons = screen.getAllByRole('button', { name: /accept/i });
        const denyButtons = screen.getAllByRole('button', { name: /deny/i });
        expect(acceptButtons.length).toBeGreaterThanOrEqual(1);
        expect(denyButtons.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('calls apiPut when Accept button is clicked', async () => {
      await switchToAppeals();
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /accept/i }).length).toBeGreaterThan(0);
      });

      const acceptButtons = screen.getAllByRole('button', { name: /accept/i });
      fireEvent.click(acceptButtons[0]);

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/moderation/appeals/app1',
          { status: 'accepted' }
        );
      });
    });

    it('calls apiPut when Deny button is clicked', async () => {
      await switchToAppeals();
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /deny/i }).length).toBeGreaterThan(0);
      });

      const denyButtons = screen.getAllByRole('button', { name: /deny/i });
      fireEvent.click(denyButtons[0]);

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/moderation/appeals/app1',
          { status: 'denied' }
        );
      });
    });

    it('shows success message after appeal action', async () => {
      await switchToAppeals();
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /accept/i }).length).toBeGreaterThan(0);
      });

      const acceptButtons = screen.getAllByRole('button', { name: /accept/i });
      fireEvent.click(acceptButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/appeal accepted/i)).toBeInTheDocument();
      });
    });

    it('shows empty state when no appeals exist', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/moderation/reports') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        if (path === '/moderation/appeals') return Promise.resolve({ ok: true, data: [], meta: { total: 0 } });
        return Promise.resolve({ ok: false, data: null });
      });

      await switchToAppeals();

      await waitFor(() => {
        expect(screen.getByText('No appeals')).toBeInTheDocument();
      });
    });
  });
});
