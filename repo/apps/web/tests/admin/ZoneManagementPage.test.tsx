import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ZoneManagementPage from '../../src/pages/staff/ZoneManagementPage';

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

const mockZones = [
  {
    _id: 'z1',
    name: 'Zone Alpha',
    description: 'Main floor quiet zone',
    isActive: true,
    version: 1,
  },
  {
    _id: 'z2',
    name: 'Zone Beta',
    description: '',
    isActive: false,
    version: 3,
  },
  {
    _id: 'z3',
    name: 'Zone Gamma',
    description: 'Collaborative space',
    isActive: true,
    version: 2,
  },
];

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ZoneManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ ok: true, data: mockZones });
    mockApiPost.mockResolvedValue({ ok: true });
    mockApiPut.mockResolvedValue({ ok: true });
  });

  describe('Page heading and controls', () => {
    it('renders the Zone Management heading', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /zone management/i })).toBeInTheDocument();
      });
    });

    it('renders the Create Zone button', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching zones', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<ZoneManagementPage />);
      expect(screen.getByText(/loading zones/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<ZoneManagementPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no zones exist', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText(/no zones yet/i)).toBeInTheDocument();
      });
    });

    it('shows helpful message in empty state', async () => {
      mockApiGet.mockResolvedValue({ ok: true, data: [] });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText(/create your first zone/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when fetch fails', async () => {
      mockApiGet.mockResolvedValue({ ok: false, error: { message: 'Network error' } });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('shows fallback error when no message provided', async () => {
      mockApiGet.mockResolvedValue({ ok: false });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load zones')).toBeInTheDocument();
      });
    });
  });

  describe('Zone table rendering', () => {
    it('renders zone names in table', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Zone Alpha')).toBeInTheDocument();
      });
      expect(screen.getByText('Zone Beta')).toBeInTheDocument();
      expect(screen.getByText('Zone Gamma')).toBeInTheDocument();
    });

    it('renders zone descriptions', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Main floor quiet zone')).toBeInTheDocument();
      });
      expect(screen.getByText('Collaborative space')).toBeInTheDocument();
    });

    it('renders Active badges for active zones', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        const activeBadges = screen.getAllByText('Active');
        expect(activeBadges.length).toBe(2);
      });
    });

    it('renders Inactive badge for inactive zones', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
      });
    });

    it('renders Edit buttons for each zone', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        expect(editButtons.length).toBe(3);
      });
    });

    it('renders table column headers', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByText('Name')).toBeInTheDocument();
      });
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  describe('Create Zone modal', () => {
    it('opens Create Zone modal when button is clicked', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      expect(screen.getByRole('heading', { name: /^create zone$/i })).toBeInTheDocument();
    });

    it('renders Zone Name label in the modal', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      expect(screen.getByText('Zone Name')).toBeInTheDocument();
    });

    it('renders Description label in the modal (modal open)', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      // "Description" appears at least twice: table header + modal label
      const descRefs = screen.getAllByText('Description');
      expect(descRefs.length).toBeGreaterThanOrEqual(2);
    });

    it('does not show Active checkbox in create modal (only in edit)', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('closes modal when Cancel is clicked', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));
      expect(screen.getByRole('heading', { name: /^create zone$/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /^create zone$/i })).not.toBeInTheDocument();
      });
    });

    it('calls apiPost when zone is created', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      // Fill zone name
      const nameInput = screen.getAllByRole('textbox')[0];
      fireEvent.change(nameInput, { target: { value: 'Zone Delta' } });

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/zones',
          expect.objectContaining({ name: 'Zone Delta' })
        );
      });
    });

    it('shows form error when apiPost fails', async () => {
      mockApiPost.mockResolvedValue({ ok: false, error: { message: 'Zone already exists' } });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      const nameInput = screen.getAllByRole('textbox')[0];
      fireEvent.change(nameInput, { target: { value: 'Zone Alpha' } });

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.getByText('Zone already exists')).toBeInTheDocument();
      });
    });

    it('shows fallback error when apiPost fails with no message', async () => {
      mockApiPost.mockResolvedValue({ ok: false });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));

      const nameInput = screen.getAllByRole('textbox')[0];
      fireEvent.change(nameInput, { target: { value: 'Test Zone' } });

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.getByText('Operation failed')).toBeInTheDocument();
      });
    });

    it('closes modal and refetches after successful create', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create zone/i })).toBeInTheDocument();
      });

      const initialGetCount = mockApiGet.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: /create zone/i }));
      const nameInput = screen.getAllByRole('textbox')[0];
      fireEvent.change(nameInput, { target: { value: 'Zone Delta' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /^create zone$/i })).not.toBeInTheDocument();
      });
      expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialGetCount);
    });
  });

  describe('Edit Zone modal', () => {
    it('opens Edit Zone modal with pre-filled data when Edit is clicked', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      expect(screen.getByRole('heading', { name: /^edit zone$/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue('Zone Alpha')).toBeInTheDocument();
    });

    it('shows pre-filled description in edit modal', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      expect(screen.getByDisplayValue('Main floor quiet zone')).toBeInTheDocument();
    });

    it('shows Active checkbox in edit modal', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('Active checkbox is checked for active zone', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('Active checkbox is unchecked for inactive zone', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      // Click edit for Zone Beta (second row, index 1), which is inactive
      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[1]);

      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('calls apiPut when edit form is saved', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

      // Modify the zone name
      const nameInput = screen.getByDisplayValue('Zone Alpha');
      fireEvent.change(nameInput, { target: { value: 'Zone Alpha Updated' } });

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          expect.stringContaining('/zones/z1'),
          expect.objectContaining({ name: 'Zone Alpha Updated', version: 1 })
        );
      });
    });

    it('shows form error when apiPut fails', async () => {
      mockApiPut.mockResolvedValue({ ok: false, error: { message: 'Stale version' } });
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.getByText('Stale version')).toBeInTheDocument();
      });
    });

    it('closes edit modal when Cancel is clicked', async () => {
      renderWithRouter(<ZoneManagementPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
      expect(screen.getByRole('heading', { name: /^edit zone$/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /^edit zone$/i })).not.toBeInTheDocument();
      });
    });
  });
});
