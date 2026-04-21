import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BusinessHoursPage from '../../src/pages/staff/BusinessHoursPage';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('../../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
  apiDelete: (...args: any[]) => mockApiDelete(...args),
  apiPut: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

// Suppress window.confirm in jsdom
vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

// ── Test data ──────────────────────────────────────────────────────────────────

const mockZones = [
  { _id: 'zone1', name: 'Library Floor 1' },
  { _id: 'zone2', name: 'Library Floor 2' },
];

const mockRooms = [
  { _id: 'room1', name: 'Study Pod A' },
  { _id: 'room2', name: 'Group Room B' },
];

const mockHours = [
  { _id: 'bh1', scope: 'site', scopeId: null, dayOfWeek: 1, openTime: '07:00', closeTime: '22:00', isActive: true },
  { _id: 'bh2', scope: 'site', scopeId: null, dayOfWeek: 2, openTime: '08:00', closeTime: '20:00', isActive: true },
  { _id: 'bh3', scope: 'site', scopeId: null, dayOfWeek: 6, openTime: '10:00', closeTime: '18:00', isActive: true },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
    if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
    if (path === '/business-hours') return Promise.resolve({ ok: true, data: mockHours });
    return Promise.resolve({ ok: false, data: null });
  });
  mockApiPost.mockResolvedValue({ ok: true });
  mockApiDelete.mockResolvedValue({ ok: true });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BusinessHoursPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading', () => {
    it('renders the Business Hours heading', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /business hours/i })).toBeInTheDocument();
      });
    });

    it('renders the Set Hours button', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching hours', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<BusinessHoursPage />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('renders a spinner element while loading', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      const { container } = renderWithRouter(<BusinessHoursPage />);
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Hours table', () => {
    it('renders table columns', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Day')).toBeInTheDocument();
      });
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Close')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('renders a row for each business hours entry', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Monday')).toBeInTheDocument();
      });
      expect(screen.getByText('Tuesday')).toBeInTheDocument();
      expect(screen.getByText('Saturday')).toBeInTheDocument();
    });

    it('displays open and close times', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('07:00')).toBeInTheDocument();
      });
      expect(screen.getByText('22:00')).toBeInTheDocument();
      expect(screen.getByText('08:00')).toBeInTheDocument();
    });

    it('renders Delete buttons for each entry', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
        expect(deleteButtons.length).toBe(3);
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no hours are configured', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
        if (path === '/business-hours') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve({ ok: false, data: null });
      });
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText(/no business hours configured/i)).toBeInTheDocument();
      });
    });
  });

  describe('Scope filter', () => {
    it('renders the Scope selector', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Scope')).toBeInTheDocument();
      });
      expect(screen.getByText('Site Default')).toBeInTheDocument();
      expect(screen.getByText('Zone Override')).toBeInTheDocument();
      expect(screen.getByText('Room Override')).toBeInTheDocument();
    });

    it('shows Zone filter when zone scope is selected', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Site Default')).toBeInTheDocument();
      });

      const scopeSelects = screen.getAllByRole('combobox');
      fireEvent.change(scopeSelects[0], { target: { value: 'zone' } });

      await waitFor(() => {
        expect(screen.getByText('Filter by Zone')).toBeInTheDocument();
      });
      expect(screen.getByText('Library Floor 1')).toBeInTheDocument();
    });

    it('shows Room filter when room scope is selected', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Site Default')).toBeInTheDocument();
      });

      const scopeSelects = screen.getAllByRole('combobox');
      fireEvent.change(scopeSelects[0], { target: { value: 'room' } });

      await waitFor(() => {
        expect(screen.getByText('Filter by Room')).toBeInTheDocument();
      });
      expect(screen.getByText('Study Pod A')).toBeInTheDocument();
    });

    it('calls apiGet with scope param when scope changes', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Site Default')).toBeInTheDocument();
      });

      mockApiGet.mockClear();
      const scopeSelects = screen.getAllByRole('combobox');
      fireEvent.change(scopeSelects[0], { target: { value: 'zone' } });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/business-hours',
          expect.objectContaining({ scope: 'zone' })
        );
      });
    });
  });

  describe('Set Hours modal', () => {
    it('opens the Set Business Hours modal when button is clicked', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /set hours/i }));

      expect(screen.getByText('Set Business Hours')).toBeInTheDocument();
    });

    it('renders day of week selector in modal', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /set hours/i }));

      expect(screen.getByText('Day of Week')).toBeInTheDocument();
      expect(screen.getByText('Sunday')).toBeInTheDocument();
    });

    it('renders Open Time and Close Time inputs in modal', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /set hours/i }));

      expect(screen.getByText('Open Time')).toBeInTheDocument();
      expect(screen.getByText('Close Time')).toBeInTheDocument();
    });

    it('closes the modal when Cancel is clicked', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /set hours/i }));
      expect(screen.getByText('Set Business Hours')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByText('Set Business Hours')).not.toBeInTheDocument();
      });
    });

    it('calls apiPost when form is submitted', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /set hours/i }));

      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/business-hours',
          expect.objectContaining({
            scope: 'site',
            dayOfWeek: 0,
          })
        );
      });
    });

    it('shows a required zone selector inside modal when zone scope is active', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getByText('Site Default')).toBeInTheDocument();
      });

      // Switch to zone scope
      const scopeSelects = screen.getAllByRole('combobox');
      fireEvent.change(scopeSelects[0], { target: { value: 'zone' } });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /set hours/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /set hours/i }));

      await waitFor(() => {
        expect(screen.getByText('Set Business Hours')).toBeInTheDocument();
      });

      // The modal should show a required zone selector with "Select a zone..." placeholder
      expect(screen.getByText('Select a zone...')).toBeInTheDocument();
      // The zone selector is required
      const zoneSelect = screen.getByDisplayValue('Select a zone...');
      expect(zoneSelect).toHaveAttribute('required');
    });
  });

  describe('Delete action', () => {
    it('calls apiDelete when Delete button is clicked and confirmed', async () => {
      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
        expect(deleteButtons.length).toBeGreaterThan(0);
      });

      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(mockApiDelete).toHaveBeenCalledWith('/business-hours/bh1');
      });
    });

    it('does not call apiDelete when confirm is cancelled', async () => {
      vi.mocked(window.confirm).mockReturnValueOnce(false);

      renderWithRouter(<BusinessHoursPage />);
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /delete/i }).length).toBeGreaterThan(0);
      });

      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]);

      expect(mockApiDelete).not.toHaveBeenCalled();
    });
  });
});
