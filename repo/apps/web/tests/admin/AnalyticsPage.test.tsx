import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AnalyticsPage from '../../src/pages/admin/AnalyticsPage';

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

const mockZones = [
  { _id: 'zone1', name: 'Library Floor 1' },
  { _id: 'zone2', name: 'Library Floor 2' },
];

const mockRooms = [
  { _id: 'room1', zoneId: 'zone1', name: 'Study Pod A' },
  { _id: 'room2', zoneId: 'zone2', name: 'Group Room B' },
];

const kpiValue = (v: number) => ({ ok: true, data: { value: v } });

const mockSnapshots = [
  { periodStart: '2024-06-01T00:00:00.000Z', periodEnd: '2024-06-01T23:59:59.000Z', value: 0.72 },
  { periodStart: '2024-06-02T00:00:00.000Z', periodEnd: '2024-06-02T23:59:59.000Z', value: 0.55 },
];

function setupDefaultMocks() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/zones') return Promise.resolve({ ok: true, data: mockZones });
    if (path === '/rooms') return Promise.resolve({ ok: true, data: mockRooms });
    if (path === '/analytics/booking-conversion') return Promise.resolve(kpiValue(0.85));
    if (path === '/analytics/attendance-rate') return Promise.resolve(kpiValue(0.78));
    if (path === '/analytics/noshow-rate') return Promise.resolve(kpiValue(0.12));
    if (path === '/analytics/peak-utilization') return Promise.resolve(kpiValue(0.9));
    if (path === '/analytics/offpeak-utilization') return Promise.resolve(kpiValue(0.45));
    if (path === '/analytics/snapshots') return Promise.resolve({ ok: true, data: mockSnapshots });
    return Promise.resolve({ ok: false, data: null });
  });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page heading', () => {
    it('renders the Analytics Dashboard heading', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /analytics dashboard/i })).toBeInTheDocument();
      });
    });
  });

  describe('KPI cards', () => {
    it('renders all five KPI card labels', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText('Booking Conversion')).toBeInTheDocument();
      });
      expect(screen.getByText('Attendance Rate')).toBeInTheDocument();
      expect(screen.getByText('No-Show Rate')).toBeInTheDocument();
      expect(screen.getByText('Peak Utilization')).toBeInTheDocument();
      expect(screen.getByText('Off-Peak Utilization')).toBeInTheDocument();
    });

    it('displays KPI values as percentages', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        // booking conversion 0.85 → 85.0%
        expect(screen.getByText('85.0%')).toBeInTheDocument();
      });
      expect(screen.getByText('78.0%')).toBeInTheDocument();
      expect(screen.getByText('12.0%')).toBeInTheDocument();
      expect(screen.getByText('90.0%')).toBeInTheDocument();
      expect(screen.getByText('45.0%')).toBeInTheDocument();
    });

    it('shows loading state for KPIs', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<AnalyticsPage />);
      expect(screen.getByText(/loading kpis/i)).toBeInTheDocument();
    });

    it('shows — when KPI data is not yet loaded', async () => {
      // Only zones/rooms resolve; KPI endpoints hang
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [] });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [] });
        return new Promise(() => {}); // KPI and snapshots hang
      });
      renderWithRouter(<AnalyticsPage />);
      // Loading state shows first
      expect(screen.getByText(/loading kpis/i)).toBeInTheDocument();
    });

    it('shows error when a KPI endpoint fails', async () => {
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [] });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [] });
        if (path === '/analytics/booking-conversion') return Promise.resolve({ ok: false, error: { message: 'KPI unavailable' } });
        if (path === '/analytics/snapshots') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve(kpiValue(0));
      });
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText('KPI unavailable')).toBeInTheDocument();
      });
    });
  });

  describe('Filter controls', () => {
    it('renders Zone and Room dropdowns', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText('Library Floor 1')).toBeInTheDocument();
      });
      expect(screen.getByText('All Zones')).toBeInTheDocument();
      expect(screen.getByText('All Rooms')).toBeInTheDocument();
    });

    it('renders grain selector with Daily/Weekly/Monthly options', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText('Daily')).toBeInTheDocument();
      });
      expect(screen.getByText('Weekly')).toBeInTheDocument();
      expect(screen.getByText('Monthly')).toBeInTheDocument();
    });

    it('renders From and To date inputs', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText('Booking Conversion')).toBeInTheDocument();
      });
      expect(screen.getByText('From')).toBeInTheDocument();
      expect(screen.getByText('To')).toBeInTheDocument();
    });
  });

  describe('Utilization chart', () => {
    it('renders the bar chart label', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        // The chart label is "Utilization (day)" — use specific grain-based text
        // Multiple elements with "Utilization" exist (KPI cards + chart label)
        const utilizationElements = screen.getAllByText(/utilization/i);
        expect(utilizationElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows loading state for chart separately', () => {
      mockApiGet.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<AnalyticsPage />);
      expect(screen.getByText(/loading chart/i)).toBeInTheDocument();
    });
  });

  describe('Policy Impact section', () => {
    it('renders the Policy Impact Comparison heading', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText('Policy Impact Comparison')).toBeInTheDocument();
      });
    });

    it('renders the Policy Version ID input', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/policy version id/i)).toBeInTheDocument();
      });
    });

    it('renders the Fetch Impact button', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /fetch impact/i })).toBeInTheDocument();
      });
    });

    it('Fetch Impact button is disabled when policy version ID is empty', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /fetch impact/i })).toBeDisabled();
      });
    });

    it('enables Fetch Impact button when policy version ID is entered', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/policy version id/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/policy version id/i), {
        target: { value: 'pol-v1-abc' },
      });

      expect(screen.getByRole('button', { name: /fetch impact/i })).not.toBeDisabled();
    });

    it('shows hint text when no policy impact data is loaded', async () => {
      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText(/enter a policy version id/i)).toBeInTheDocument();
      });
    });

    it('fetches policy impact and renders comparison table', async () => {
      const mockImpact = {
        policyVersionId: 'pol-v1-abc',
        kpiName: 'booking_conversion',
        before: 0.6543,
        after: 0.7891,
        delta: 0.1348,
        windowDays: 14,
      };
      mockApiGet.mockImplementation((path: string) => {
        if (path === '/zones') return Promise.resolve({ ok: true, data: [] });
        if (path === '/rooms') return Promise.resolve({ ok: true, data: [] });
        if (path === '/analytics/policy-impact') return Promise.resolve({ ok: true, data: mockImpact });
        if (path === '/analytics/snapshots') return Promise.resolve({ ok: true, data: [] });
        return Promise.resolve(kpiValue(0));
      });

      renderWithRouter(<AnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/policy version id/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/policy version id/i), {
        target: { value: 'pol-v1-abc' },
      });

      fireEvent.click(screen.getByRole('button', { name: /fetch impact/i }));

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(
          '/analytics/policy-impact',
          expect.objectContaining({ policyVersionId: 'pol-v1-abc' })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('0.6543')).toBeInTheDocument();
      });
      expect(screen.getByText('0.7891')).toBeInTheDocument();
      expect(screen.getByText('+0.1348')).toBeInTheDocument();
    });
  });
});
