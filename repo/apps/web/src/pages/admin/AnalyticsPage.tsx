import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../../utils/api';

interface Zone { _id: string; name: string; }
interface Room { _id: string; name: string; }

interface KPIData {
  bookingConversion?: number;
  attendanceRate?: number;
  noShowRate?: number;
  peakUtilization?: number;
  offPeakUtilization?: number;
}

interface TimeSeriesPoint {
  period: string;
  value: number;
  label?: string;
}

interface PolicyImpact {
  policyVersionId: string;
  kpiName: string;
  before: number;
  after: number;
  delta: number;
  windowDays: number;
}

// For policy impact form
const KPI_NAMES = [
  'booking_conversion',
  'attendance_rate',
  'noshow_rate',
  'peak_utilization',
  'offpeak_utilization',
];

function pct(v?: number) {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}

function KPICard({ label, value, color = 'var(--primary)' }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
      <div style={{ fontSize: '2rem', fontWeight: 700, color, marginBottom: '0.25rem' }}>{value}</div>
      <div className="text-sm text-gray">{label}</div>
    </div>
  );
}

function BarChart({ data, label }: { data: TimeSeriesPoint[]; label: string }) {
  if (!data.length) return <p className="text-sm text-gray">No data for selected period.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div>
      <p style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '100px', overflowX: 'auto' }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: '32px' }}>
            <div
              title={`${d.period}: ${d.value}`}
              style={{
                width: '100%',
                height: `${Math.max((d.value / max) * 80, 2)}px`,
                background: 'var(--primary)',
                borderRadius: '3px 3px 0 0',
                opacity: 0.85,
              }}
            />
            <span style={{ fontSize: '0.6rem', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
              {d.label || d.period}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const [filterZone, setFilterZone] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [grain, setGrain] = useState('day');

  const [kpi, setKPI] = useState<KPIData | null>(null);
  const [kpiLoading, setKPILoading] = useState(false);
  const [kpiError, setKPIError] = useState('');

  const [utilSeries, setUtilSeries] = useState<TimeSeriesPoint[]>([]);
  const [utilLoading, setUtilLoading] = useState(false);

  const [policyImpact, setPolicyImpact] = useState<PolicyImpact | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyVersionId, setPolicyVersionId] = useState('');
  const [policyKpiName, setPolicyKpiName] = useState('booking_conversion');

  useEffect(() => {
    apiGet<Zone[]>('/zones', { pageSize: '100' }).then((r) => { if (r.ok && r.data) setZones(r.data); });
    apiGet<Room[]>('/rooms', { pageSize: '200' }).then((r) => { if (r.ok && r.data) setRooms(r.data); });
  }, []);

  const buildParams = useCallback((): Record<string, string> => {
    const p: Record<string, string> = {
      startDate: new Date(filterFrom).toISOString(),
      endDate: new Date(filterTo + 'T23:59:59').toISOString(),
      grain,
    };
    if (filterZone) p.zoneId = filterZone;
    if (filterRoom) p.roomId = filterRoom;
    return p;
  }, [filterFrom, filterTo, grain, filterZone, filterRoom]);

  const fetchKPI = useCallback(async () => {
    setKPILoading(true);
    setKPIError('');
    const params = buildParams();
    const [bcRes, arRes, nsRes, puRes, opRes] = await Promise.all([
      apiGet<{ value: number }>('/analytics/booking-conversion', params),
      apiGet<{ value: number }>('/analytics/attendance-rate', params),
      apiGet<{ value: number }>('/analytics/noshow-rate', params),
      apiGet<{ value: number }>('/analytics/peak-utilization', params),
      apiGet<{ value: number }>('/analytics/offpeak-utilization', params),
    ]);
    const anyError = [bcRes, arRes, nsRes, puRes, opRes].find((r) => !r.ok);
    if (anyError) {
      setKPIError(anyError.error?.message || 'Failed to load KPIs');
    } else {
      setKPI({
        bookingConversion: bcRes.data?.value,
        attendanceRate: arRes.data?.value,
        noShowRate: nsRes.data?.value,
        peakUtilization: puRes.data?.value,
        offPeakUtilization: opRes.data?.value,
      });
    }
    setKPILoading(false);
  }, [buildParams]);

  const fetchUtilization = useCallback(async () => {
    setUtilLoading(true);
    const res = await apiGet<{ periodStart: string; periodEnd: string; value: number }[]>('/analytics/snapshots', buildParams());
    if (res.ok && res.data) {
      const mapped: TimeSeriesPoint[] = (res.data as { periodStart: string; periodEnd: string; value: number }[]).map((d) => ({
        period: d.periodStart,
        value: d.value,
        label: new Date(d.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      }));
      setUtilSeries(mapped);
    }
    setUtilLoading(false);
  }, [buildParams]);

  const fetchPolicyImpact = useCallback(async () => {
    if (!policyVersionId.trim() || !policyKpiName) return;
    setPolicyLoading(true);
    const res = await apiGet<PolicyImpact>('/analytics/policy-impact', {
      policyVersionId: policyVersionId.trim(),
      kpiName: policyKpiName,
    });
    if (res.ok && res.data) setPolicyImpact(res.data);
    else setPolicyImpact(null);
    setPolicyLoading(false);
  }, [policyVersionId, policyKpiName]);

  useEffect(() => {
    fetchKPI();
    fetchUtilization();
  }, [fetchKPI, fetchUtilization]);

  const filteredRooms = filterZone ? rooms.filter((r) => (r as { zoneId?: string }).zoneId === filterZone) : rooms;

  return (
    <div>
      <h1>Analytics Dashboard</h1>

      {/* Filters */}
      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Zone</label>
            <select value={filterZone} onChange={(e) => { setFilterZone(e.target.value); setFilterRoom(''); }}>
              <option value="">All Zones</option>
              {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Room</label>
            <select value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)}>
              <option value="">All Rooms</option>
              {filteredRooms.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>From</label>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>To</label>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Grain</label>
            <select value={grain} onChange={(e) => setGrain(e.target.value)}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPIs */}
      {kpiError && <div className="alert alert-error">{kpiError}</div>}

      {kpiLoading ? (
        <div className="loading"><div className="spinner" />Loading KPIs...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <KPICard label="Booking Conversion" value={pct(kpi?.bookingConversion)} color="var(--primary)" />
          <KPICard label="Attendance Rate" value={pct(kpi?.attendanceRate)} color="var(--success)" />
          <KPICard label="No-Show Rate" value={pct(kpi?.noShowRate)} color="var(--danger)" />
          <KPICard label="Peak Utilization" value={pct(kpi?.peakUtilization)} color="var(--warning)" />
          <KPICard label="Off-Peak Utilization" value={pct(kpi?.offPeakUtilization)} color="var(--gray-500)" />
        </div>
      )}

      {/* Utilization Chart */}
      <div className="card mb-4">
        {utilLoading ? (
          <div className="loading"><div className="spinner" />Loading chart...</div>
        ) : (
          <BarChart data={utilSeries} label={`Utilization (${grain})`} />
        )}
      </div>

      {/* Policy Impact */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Policy Impact Comparison</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Policy Version ID</label>
            <input
              type="text"
              value={policyVersionId}
              onChange={(e) => setPolicyVersionId(e.target.value)}
              placeholder="Policy version ID..."
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>KPI Name</label>
            <select value={policyKpiName} onChange={(e) => setPolicyKpiName(e.target.value)}>
              {KPI_NAMES.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={policyLoading || !policyVersionId.trim()}
              onClick={fetchPolicyImpact}
            >
              {policyLoading ? 'Loading...' : 'Fetch Impact'}
            </button>
          </div>
        </div>
        {policyImpact ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Delta</th>
                  <th>Window (days)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ textTransform: 'capitalize' }}>{policyImpact.kpiName.replace(/_/g, ' ')}</td>
                  <td>{policyImpact.before.toFixed(4)}</td>
                  <td>{policyImpact.after.toFixed(4)}</td>
                  <td>
                    <span style={{ color: policyImpact.delta >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                      {policyImpact.delta >= 0 ? '+' : ''}{policyImpact.delta.toFixed(4)}
                    </span>
                  </td>
                  <td>{policyImpact.windowDays}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray">Enter a Policy Version ID and KPI name above, then click Fetch Impact.</p>
        )}
      </div>
    </div>
  );
}
