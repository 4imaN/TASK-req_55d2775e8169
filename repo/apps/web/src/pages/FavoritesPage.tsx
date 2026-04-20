import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete } from '../utils/api';

interface Room {
  _id: string;
  name: string;
  zoneId: { _id: string; name: string } | string;
  capacity?: number;
  amenities: string[];
  isActive: boolean;
  description?: string;
}

interface Favorite {
  _id: string;
  roomId: string;
  room?: Room;
  createdAt: string;
}

function zoneName(z: Room['zoneId']) {
  return typeof z === 'object' ? z.name : z;
}

function amenityLabel(a: string) {
  return a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchFavorites = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<Favorite[]>('/favorites');
    if (res.ok && res.data) {
      setFavorites(res.data);
    } else {
      setError(res.error?.message || 'Failed to load favorites');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  async function handleUnfavorite(roomId: string) {
    setRemovingId(roomId);
    const res = await apiDelete(`/favorites/${roomId}`);
    if (res.ok) {
      setSuccess('Room removed from favorites.');
      setFavorites((prev) => prev.filter((f) => f.roomId !== roomId));
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(res.error?.message || 'Failed to remove favorite');
    }
    setRemovingId(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Favorite Rooms</h1>
        <button className="btn btn-primary" onClick={() => navigate('/rooms')}>Browse Rooms</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading favorites...</div>
      ) : favorites.length === 0 ? (
        <div className="empty-state">
          <h3>No favorites yet</h3>
          <p>Mark rooms as favorite while browsing to see them here.</p>
          <button className="btn btn-primary mt-4" onClick={() => navigate('/rooms')}>Browse Rooms</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {favorites.map((fav) => {
            const room = fav.room;
            if (!room) return null;
            return (
              <div
                key={fav._id}
                className="card"
                style={{ borderLeft: '3px solid var(--primary)', position: 'relative' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{room.name}</h3>
                  <span className={`badge ${room.isActive ? 'badge-success' : 'badge-gray'}`}>
                    {room.isActive ? 'Available' : 'Inactive'}
                  </span>
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

                <div className="flex gap-2 mt-2">
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => navigate(`/rooms?roomId=${room._id}`)}
                  >
                    View Availability
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={removingId === fav.roomId}
                    onClick={() => handleUnfavorite(fav.roomId)}
                    title="Remove from favorites"
                  >
                    {removingId === fav.roomId ? '...' : '★'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
