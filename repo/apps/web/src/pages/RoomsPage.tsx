import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

interface Zone {
  _id: string;
  name: string;
  isActive: boolean;
}

interface Room {
  _id: string;
  zoneId: string;
  name: string;
  description?: string;
  capacity?: number;
  amenities: string[];
  isActive: boolean;
}

interface Slot {
  start: string;
  end: string;
  available: boolean;
}

interface AlternativeSlot {
  roomId: string;
  zoneId: string;
  start: string;
  end: string;
}

const SLOT_MINUTES = 15;

function fmt15(dt: string) {
  return new Date(dt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function todayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function RoomsPage() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 12;

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteLoading, setFavoriteLoading] = useState<Set<string>>(new Set());

  const [calRoom, setCalRoom] = useState<Room | null>(null);
  const [calDate, setCalDate] = useState(() => {
    const d = todayLocal();
    return d.toISOString().slice(0, 10);
  });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');

  // Booking modal
  const [bookRoom, setBookRoom] = useState<Room | null>(null);
  const [bookStart, setBookStart] = useState('');
  const [bookEnd, setBookEnd] = useState('');
  const [bookNotes, setBookNotes] = useState('');
  const [bookSubmitting, setBookSubmitting] = useState(false);
  const [bookError, setBookError] = useState('');
  const [alternatives, setAlternatives] = useState<AlternativeSlot[]>([]);
  const [conflictReason, setConflictReason] = useState('');

  const fetchZones = useCallback(async () => {
    const res = await apiGet<Zone[]>('/zones', { pageSize: '100' });
    if (res.ok && res.data) setZones(res.data);
  }, []);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError('');
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (filterZone) params.zoneId = filterZone;
    const res = await apiGet<Room[]>('/rooms', params);
    if (res.ok && res.data) {
      setRooms(res.data);
      setTotal((res.meta as { total?: number })?.total || 0);
    } else {
      setError(res.error?.message || 'Failed to load rooms');
    }
    setLoading(false);
  }, [page, filterZone]);

  const fetchFavorites = useCallback(async () => {
    if (!user) return;
    const res = await apiGet<{ roomId: { _id: string } | string }[]>('/favorites');
    if (res.ok && res.data) {
      const ids = new Set(res.data.map((f) => typeof f.roomId === 'object' ? f.roomId._id : f.roomId));
      setFavorites(ids);
    }
  }, [user]);

  useEffect(() => { fetchZones(); }, [fetchZones]);
  useEffect(() => { fetchRooms(); }, [fetchRooms]);
  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  async function fetchSlots(roomId: string, date: string) {
    setSlotsLoading(true);
    setSlotsError('');
    setSlots([]);
    const dayStart = new Date(date + 'T00:00:00').toISOString();
    const dayEnd = new Date(date + 'T23:59:59').toISOString();
    const res = await apiGet<{ date: string; slots: Slot[] }[]>('/reservations/availability', {
      roomId,
      startDate: dayStart,
      endDate: dayEnd,
    });
    if (res.ok && res.data) {
      const dayGroups = res.data as { date: string; slots: Slot[] }[];
      const allSlots: Slot[] = dayGroups.flatMap((g) => g.slots || []);
      setSlots(allSlots);
    } else {
      setSlotsError(res.error?.message || 'Failed to load availability');
    }
    setSlotsLoading(false);
  }

  function openCalendar(room: Room) {
    setCalRoom(room);
    fetchSlots(room._id, calDate);
  }

  function openBooking(room: Room) {
    setBookRoom(room);
    setBookStart('');
    setBookEnd('');
    setBookNotes('');
    setBookError('');
    setAlternatives([]);
    setConflictReason('');
  }

  async function handleBook() {
    if (!bookRoom || !bookStart || !bookEnd) { setBookError('Select start and end time.'); return; }
    if (new Date(bookStart) >= new Date(bookEnd)) { setBookError('End must be after start.'); return; }
    setBookSubmitting(true);
    setBookError('');
    setAlternatives([]);
    setConflictReason('');
    const idempotencyKey = Date.now() + '-' + Math.random().toString(36).slice(2);
    const payload: Record<string, unknown> = {
      roomId: bookRoom._id,
      startAtUtc: new Date(bookStart).toISOString(),
      endAtUtc: new Date(bookEnd).toISOString(),
      idempotencyKey,
    };
    if (bookNotes.trim()) {
      payload.notes = bookNotes.trim();
    }
    const res = await apiPost('/reservations', payload);
    if (res.ok) {
      setSuccess(`Room "${bookRoom.name}" booked successfully!`);
      setBookRoom(null);
      setAlternatives([]);
      setConflictReason('');
      setTimeout(() => setSuccess(''), 4000);
    } else {
      setBookError(res.error?.message || 'Booking failed');
      const details = res.error?.details as Record<string, unknown> | undefined;
      if (details?.alternatives && Array.isArray(details.alternatives) && details.alternatives.length > 0) {
        setAlternatives(details.alternatives as AlternativeSlot[]);
      }
      if (details?.conflictReason && typeof details.conflictReason === 'string') {
        setConflictReason(details.conflictReason);
      }
    }
    setBookSubmitting(false);
  }

  async function bookAlternative(alt: AlternativeSlot) {
    if (!bookRoom) return;
    // Pre-fill form fields with the alternative's times
    // Convert ISO strings to datetime-local format (YYYY-MM-DDTHH:mm)
    const toLocalInput = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    // Find the target room — may differ from the currently selected room
    const targetRoom = rooms.find((r) => r._id === alt.roomId) || bookRoom;

    setBookRoom(targetRoom);
    setBookStart(toLocalInput(alt.start));
    setBookEnd(toLocalInput(alt.end));
    setBookError('');
    setAlternatives([]);
    setConflictReason('');

    // Immediately submit the booking with the alternative slot
    setBookSubmitting(true);
    const idempotencyKey = Date.now() + '-' + Math.random().toString(36).slice(2);
    const res = await apiPost('/reservations', {
      roomId: alt.roomId,
      startAtUtc: alt.start,
      endAtUtc: alt.end,
      idempotencyKey,
    });
    if (res.ok) {
      setSuccess(`Room "${targetRoom.name}" booked successfully!`);
      setBookRoom(null);
      setTimeout(() => setSuccess(''), 4000);
    } else {
      setBookError(res.error?.message || 'Booking failed');
      const details = res.error?.details as Record<string, unknown> | undefined;
      if (details?.alternatives && Array.isArray(details.alternatives) && details.alternatives.length > 0) {
        setAlternatives(details.alternatives as AlternativeSlot[]);
      }
      if (details?.conflictReason && typeof details.conflictReason === 'string') {
        setConflictReason(details.conflictReason);
      }
    }
    setBookSubmitting(false);
  }

  async function toggleFavorite(room: Room, e: React.MouseEvent) {
    e.stopPropagation();
    if (!user) return;
    const isFav = favorites.has(room._id);
    setFavoriteLoading((prev) => new Set([...prev, room._id]));
    if (isFav) {
      const res = await apiDelete(`/favorites/${room._id}`);
      if (res.ok) setFavorites((prev) => { const n = new Set(prev); n.delete(room._id); return n; });
    } else {
      const res = await apiPost('/favorites', { roomId: room._id });
      if (res.ok) setFavorites((prev) => new Set([...prev, room._id]));
    }
    setFavoriteLoading((prev) => { const n = new Set(prev); n.delete(room._id); return n; });
  }

  const zoneName = (zoneId: string) => zones.find((z) => z._id === zoneId)?.name || 'Unknown Zone';
  const amenityLabel = (a: string) => a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const totalPages = Math.ceil(total / pageSize);

  // Build a map from roomId → room name for resolving alternatives
  const roomMap = rooms.reduce<Record<string, string>>((acc, r) => {
    acc[r._id] = r.name;
    return acc;
  }, {});

  // Group slots into hours for display
  const slotsByHour: Record<number, Slot[]> = {};
  (Array.isArray(slots) ? slots : []).forEach((s) => {
    const h = new Date(s.start).getHours();
    if (!slotsByHour[h]) slotsByHour[h] = [];
    slotsByHour[h].push(s);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Browse Rooms</h1>
        <span className="text-sm text-gray">{total > 0 ? `${total} room${total !== 1 ? 's' : ''} available` : ''}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div className="flex items-center gap-4">
          <div className="form-group" style={{ marginBottom: 0, minWidth: '200px' }}>
            <label>Filter by Zone</label>
            <select
              value={filterZone}
              onChange={(e) => { setFilterZone(e.target.value); setPage(1); }}
            >
              <option value="">All Zones</option>
              {zones.map((z) => (
                <option key={z._id} value={z._id}>{z.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading rooms...
        </div>
      ) : rooms.length === 0 ? (
        <div className="empty-state">
          <h3>No rooms found</h3>
          <p>{filterZone ? 'No rooms in this zone.' : 'No study rooms are available right now.'}</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {rooms.map((room) => {
              const isFav = favorites.has(room._id);
              const favLoading = favoriteLoading.has(room._id);
              return (
                <div
                  key={room._id}
                  className="card"
                  style={{
                    borderLeft: `3px solid ${room.isActive ? 'var(--primary)' : 'var(--gray-300)'}`,
                    opacity: room.isActive ? 1 : 0.7,
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{room.name}</h3>
                    <div className="flex gap-1 items-center">
                      <span className={`badge ${room.isActive ? 'badge-success' : 'badge-gray'}`}>
                        {room.isActive ? 'Available' : 'Inactive'}
                      </span>
                      {user && (
                        <button
                          onClick={(e) => toggleFavorite(room, e)}
                          disabled={favLoading}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '1.1rem',
                            color: isFav ? '#f59e0b' : 'var(--gray-300)',
                            padding: '0 0.2rem',
                            lineHeight: 1,
                          }}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          {favLoading ? '...' : '★'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-gray mb-2">
                    <strong style={{ color: 'var(--gray-600)' }}>Zone:</strong> {zoneName(room.zoneId)}
                  </div>

                  {room.capacity != null && (
                    <div className="text-sm text-gray mb-2">
                      <strong style={{ color: 'var(--gray-600)' }}>Capacity:</strong> {room.capacity} person{room.capacity !== 1 ? 's' : ''}
                    </div>
                  )}

                  {room.description && (
                    <p className="text-sm text-gray mb-2" style={{ lineHeight: 1.4 }}>{room.description}</p>
                  )}

                  {room.amenities.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                      {room.amenities.map((a) => (
                        <span key={a} className="badge badge-primary" style={{ fontSize: '0.7rem' }}>
                          {amenityLabel(a)}
                        </span>
                      ))}
                    </div>
                  )}

                  {room.isActive && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => openCalendar(room)}
                      >
                        Availability
                      </button>
                      {user && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ flex: 1 }}
                          onClick={() => openBooking(room)}
                        >
                          Book Now
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Prev
              </button>
              <span className="text-sm text-gray">Page {page} of {totalPages}</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Availability Calendar Modal */}
      {calRoom && (
        <div className="modal-overlay" onClick={() => setCalRoom(null)}>
          <div className="modal" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <h2>Availability — {calRoom.name}</h2>
            <div className="flex items-center gap-4 mb-4">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Date</label>
                <input
                  type="date"
                  value={calDate}
                  onChange={(e) => {
                    setCalDate(e.target.value);
                    fetchSlots(calRoom._id, e.target.value);
                  }}
                />
              </div>
              <div className="flex gap-4 text-sm" style={{ marginTop: '1.25rem' }}>
                <div className="flex items-center gap-1">
                  <div style={{ width: '12px', height: '12px', background: '#16a34a', borderRadius: '2px' }} />
                  <span>Available</span>
                </div>
                <div className="flex items-center gap-1">
                  <div style={{ width: '12px', height: '12px', background: '#dc2626', borderRadius: '2px' }} />
                  <span>Booked</span>
                </div>
              </div>
            </div>

            {slotsLoading ? (
              <div className="loading"><div className="spinner" />Loading slots...</div>
            ) : slotsError ? (
              <div className="alert alert-error">{slotsError}</div>
            ) : slots.length === 0 ? (
              <div className="empty-state">
                <p>No availability data for this date.</p>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
                {Object.keys(slotsByHour).sort((a, b) => Number(a) - Number(b)).map((hour) => (
                  <div key={hour} style={{ marginBottom: '0.5rem' }}>
                    <div className="text-sm text-gray" style={{ marginBottom: '0.25rem', fontWeight: 600 }}>
                      {new Date(`2000-01-01T${String(hour).padStart(2, '0')}:00:00`).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {slotsByHour[Number(hour)].map((slot, i) => (
                        <div
                          key={i}
                          title={`${fmt15(slot.start)} – ${fmt15(slot.end)}: ${slot.available ? 'Available' : 'Booked'}`}
                          style={{
                            width: '36px',
                            height: '20px',
                            borderRadius: '3px',
                            background: slot.available ? '#16a34a' : '#dc2626',
                            opacity: 0.85,
                            cursor: 'default',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              {user && calRoom.isActive && (
                <button className="btn btn-primary" onClick={() => { setCalRoom(null); openBooking(calRoom); }}>
                  Book This Room
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setCalRoom(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Book Now Modal */}
      {bookRoom && (
        <div className="modal-overlay" onClick={() => setBookRoom(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Book {bookRoom.name}</h2>
            {bookError && <div className="alert alert-error">{bookError}</div>}
            {alternatives.length > 0 && (
              <div className="card mt-2" style={{ background: 'var(--primary-light)' }}>
                <h4>Available Alternatives</h4>
                <p className="text-sm text-gray">Conflict reason: {conflictReason}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {alternatives.map((alt, i) => {
                    const start = new Date(alt.start);
                    const end = new Date(alt.end);
                    const roomName = roomMap[alt.roomId] || alt.roomId;
                    return (
                      <div key={i} className="flex items-center justify-between" style={{ padding: '0.5rem', background: 'white', borderRadius: 'var(--radius)' }}>
                        <div>
                          <strong>{roomName}</strong>
                          <span className="text-sm text-gray" style={{ marginLeft: '0.5rem' }}>
                            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-sm text-gray" style={{ marginLeft: '0.5rem' }}>
                            {start.toLocaleDateString()}
                          </span>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={() => bookAlternative(alt)}>
                          Book This
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Start Time</label>
              <input
                type="datetime-local"
                value={bookStart}
                onChange={(e) => setBookStart(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>End Time</label>
              <input
                type="datetime-local"
                value={bookEnd}
                onChange={(e) => setBookEnd(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Notes — optional</label>
              <textarea
                rows={2}
                value={bookNotes}
                onChange={(e) => setBookNotes(e.target.value)}
                placeholder="Any special notes..."
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setBookRoom(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={bookSubmitting} onClick={handleBook}>
                {bookSubmitting ? 'Booking...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
