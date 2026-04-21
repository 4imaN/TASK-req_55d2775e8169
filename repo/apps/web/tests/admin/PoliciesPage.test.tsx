import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PoliciesPage from '../../src/pages/admin/PoliciesPage';

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

const mockPolicies = [
  {
    _id: 'pv1',
    policyArea: 'booking',
    settings: { maxAdvanceDays: 14, minDurationMinutes: 30 },
    effectiveAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    _id: 'pv2',
    policyArea: 'cancellation',
    settings: { noShowPenaltyPoints: 5, gracePeriodMinutes: 10 },
    effectiveAt: '2024-02-01T00:00:00.000Z',
    createdAt: '2024-02-01T00:00:00.000Z',
  },
  {
    _id: 'pv3',
    policyArea: 'booking',
    settings: { maxAdvanceDays: 7, minDurationMinutes: 60 },
    effectiveAt: '2023-12-01T00:00:00.000Z',
    createdAt: '2023-12-01T00:00:00.000Z',
  },
];

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PoliciesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ ok: true, data: mockPolicies });
    mockApiPost.mockResolvedValue({ ok: true });
  });

  describe('Page heading', () => {
    it('renders the Policy Management heading', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /policy management/i })).toBeInTheDocument();
      });
    });

    it('renders the + New Version button', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching policies', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<PoliciesPage />);
      expect(screen.getByText(/loading policies/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<PoliciesPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no policies exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText(/no policies configured/i)).toBeInTheDocument();
      });
    });

    it('shows helpful message in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText(/create the first policy version/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Unauthorized access' } });
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('Unauthorized access')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load policies')).toBeInTheDocument();
      });
    });
  });

  describe('Policy area rendering', () => {
    it('renders policy area names from grouped data', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('booking')).toBeInTheDocument();
      });
      expect(screen.getByText('cancellation')).toBeInTheDocument();
    });

    it('renders Active badges for each policy area', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        const activeBadges = screen.getAllByText('Active');
        expect(activeBadges.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('renders collapse/expand chevrons for each area', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('booking')).toBeInTheDocument();
      });
      // Both areas should show the down arrow by default
      const downArrows = screen.getAllByText('▼');
      expect(downArrows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Expand / collapse policy areas', () => {
    it('expands a policy area when clicked and shows Current Settings', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('booking')).toBeInTheDocument();
      });

      // Find the booking card header and click it
      fireEvent.click(screen.getByText('booking'));

      await waitFor(() => {
        expect(screen.getByText('Current Settings')).toBeInTheDocument();
      });
    });

    it('shows up arrow when area is expanded', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('booking')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('booking'));

      await waitFor(() => {
        expect(screen.getByText('▲')).toBeInTheDocument();
      });
    });

    it('collapses an expanded area when clicked again', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('booking')).toBeInTheDocument();
      });

      // Expand
      fireEvent.click(screen.getByText('booking'));
      await waitFor(() => {
        expect(screen.getByText('Current Settings')).toBeInTheDocument();
      });

      // Collapse
      fireEvent.click(screen.getByText('booking'));
      await waitFor(() => {
        expect(screen.queryByText('Current Settings')).not.toBeInTheDocument();
      });
    });

    it('shows Policy History section when area has multiple versions', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('booking')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('booking'));

      await waitFor(() => {
        expect(screen.getByText('Policy History')).toBeInTheDocument();
      });
    });

    it('does not show Policy History when area has only one version', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByText('cancellation')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('cancellation'));

      await waitFor(() => {
        expect(screen.getByText('Current Settings')).toBeInTheDocument();
      });
      expect(screen.queryByText('Policy History')).not.toBeInTheDocument();
    });
  });

  describe('New Version modal', () => {
    it('opens modal when + New Version is clicked', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      expect(screen.getByText('Create New Policy Version')).toBeInTheDocument();
    });

    it('renders Policy Area input in the modal', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      expect(screen.getByPlaceholderText(/e\.g\. booking/i)).toBeInTheDocument();
    });

    it('renders the Settings JSON textarea in the modal', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      expect(screen.getByText('Settings (JSON)')).toBeInTheDocument();
    });

    it('renders Effective At label in modal', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      expect(screen.getByText(/effective at/i)).toBeInTheDocument();
    });

    it('closes modal when Cancel is clicked', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));
      expect(screen.getByText('Create New Policy Version')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText('Create New Policy Version')).not.toBeInTheDocument();
      });
    });

    it('shows validation error when Policy Area is empty on submit', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));
      fireEvent.click(screen.getByRole('button', { name: /create version/i }));

      await waitFor(() => {
        expect(screen.getByText('Policy area is required.')).toBeInTheDocument();
      });
    });

    it('shows validation error when Effective At is empty', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. booking/i), {
        target: { value: 'capacity' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create version/i }));

      await waitFor(() => {
        expect(screen.getByText('Effective At is required.')).toBeInTheDocument();
      });
    });

    it('shows JSON validation error for invalid settings', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. booking/i), {
        target: { value: 'capacity' },
      });

      // Set effective date using the datetime-local input
      const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2025-01-01T00:00' } });

      // Enter invalid JSON in the textarea
      fireEvent.change(screen.getByRole('textbox', { hidden: true }), {
        target: { value: 'not valid json' },
      });

      // Use the textarea directly since it may not have a role
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: '{ invalid json' } });

      fireEvent.click(screen.getByRole('button', { name: /create version/i }));

      await waitFor(() => {
        expect(screen.getByText('Settings must be valid JSON.')).toBeInTheDocument();
      });
    });

    it('calls apiPost with correct body on valid submission', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. booking/i), {
        target: { value: 'capacity' },
      });

      const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2025-06-01T00:00' } });

      fireEvent.click(screen.getByRole('button', { name: /create version/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/policies',
          expect.objectContaining({ policyArea: 'capacity' })
        );
      });
    });

    it('shows success message after creating a policy version', async () => {
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. booking/i), {
        target: { value: 'capacity' },
      });

      const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2025-06-01T00:00' } });

      fireEvent.click(screen.getByRole('button', { name: /create version/i }));

      await waitFor(() => {
        expect(screen.getByText('Policy version created.')).toBeInTheDocument();
      });
    });

    it('shows error in modal when apiPost fails', async () => {
      mockApiPost.mockResolvedValue({ ok: false, error: { message: 'Duplicate version' } });
      renderWithRouter(<PoliciesPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ new version/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /\+ new version/i }));

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. booking/i), {
        target: { value: 'booking' },
      });

      const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2025-06-01T00:00' } });

      fireEvent.click(screen.getByRole('button', { name: /create version/i }));

      await waitFor(() => {
        expect(screen.getByText('Duplicate version')).toBeInTheDocument();
      });
    });
  });
});
