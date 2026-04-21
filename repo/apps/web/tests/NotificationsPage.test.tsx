import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotificationsPage from '../src/pages/NotificationsPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPut: (...args: any[]) => mockApiPut(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const now = new Date().toISOString();

const mockNotifications = [
  {
    _id: 'n1',
    type: 'reservation_reminder',
    message: 'Your reservation starts in 30 minutes.',
    readAt: null,
    createdAt: now,
  },
  {
    _id: 'n2',
    type: 'booking_confirmed',
    message: 'Your booking for Study Pod A has been confirmed.',
    readAt: null,
    createdAt: now,
  },
  {
    _id: 'n3',
    type: 'system_alert',
    message: 'Scheduled maintenance tonight.',
    readAt: new Date().toISOString(),
    createdAt: now,
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

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching notifications', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithProviders(<NotificationsPage />);

      expect(screen.getByText(/loading notifications/i)).toBeInTheDocument();
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Renders notifications list', () => {
    it('renders page heading', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /notifications/i })).toBeInTheDocument();
      });
    });

    it('renders notification messages', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Your reservation starts in 30 minutes.')).toBeInTheDocument();
      });

      expect(screen.getByText('Your booking for Study Pod A has been confirmed.')).toBeInTheDocument();
      expect(screen.getByText('Scheduled maintenance tonight.')).toBeInTheDocument();
    });

    it('renders human-readable type labels', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockNotifications[0]], meta: { total: 1 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        // "reservation_reminder" should render as "Reservation Reminder"
        expect(screen.getByText('Reservation Reminder')).toBeInTheDocument();
      });
    });

    it('shows "New" badge for unread notifications', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        // Two unread notifications → two "New" badges
        expect(screen.getAllByText('New').length).toBe(2);
      });
    });

    it('does not show "New" badge for read notifications', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockNotifications[2]], meta: { total: 1 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.queryByText('New')).not.toBeInTheDocument();
      });
    });

    it('shows unread count badge in the heading', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText(/2 unread/i)).toBeInTheDocument();
      });
    });

    it('renders "Mark read" button for each unread notification', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        // Two unread → two "Mark read" buttons
        expect(screen.getAllByRole('button', { name: /mark read/i }).length).toBe(2);
      });
    });

    it('does not render "Mark read" button for already-read notifications', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockNotifications[2]], meta: { total: 1 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when there are no notifications', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [], meta: { total: 0 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText('No notifications')).toBeInTheDocument();
      });
    });

    it('shows descriptive copy in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [], meta: { total: 0 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Server error' } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });

    it('shows fallback error message when no message is provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load notifications')).toBeInTheDocument();
      });
    });
  });

  describe('Mark as read interaction', () => {
    it('calls apiPut with correct path when Mark read is clicked', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockNotifications[0]], meta: { total: 1 } });
      mockApiPut.mockResolvedValue({ ok: true });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark read/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith('/notifications/n1/read');
      });
    });

    it('removes "New" badge after marking notification as read', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [mockNotifications[0]], meta: { total: 1 } });
      mockApiPut.mockResolvedValue({ ok: true });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByText('New')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

      await waitFor(() => {
        expect(screen.queryByText('New')).not.toBeInTheDocument();
      });
    });
  });

  describe('Mark all as read', () => {
    it('renders Mark all as read button when there are unread notifications', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument();
      });
    });

    it('does not render Mark all as read button when all notifications are read', async () => {
      const allRead = mockNotifications.map((n) => ({ ...n, readAt: now }));
      mockApiGet.mockResolvedValue({ ok: true, data: allRead, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument();
      });
    });

    it('calls apiPut /notifications/read-all when button clicked', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });
      mockApiPut.mockResolvedValue({ ok: true });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith('/notifications/read-all');
      });
    });

    it('removes all "New" badges after marking all as read', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });
      mockApiPut.mockResolvedValue({ ok: true });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('New').length).toBe(2);
      });

      fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

      await waitFor(() => {
        expect(screen.queryByText('New')).not.toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('does not show pagination when total is 20 or fewer', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 3 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /prev/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
      });
    });

    it('shows pagination controls when total exceeds 20', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 45 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
      });
    });

    it('shows page count text in pagination', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 45 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        // 45 / 20 = 3 pages (ceil)
        expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      });
    });

    it('Prev button is disabled on first page', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: mockNotifications, meta: { total: 45 } });

      renderWithProviders(<NotificationsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
      });
    });
  });
});
