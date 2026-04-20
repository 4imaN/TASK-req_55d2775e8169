import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet } from '../utils/api';

interface SharedReservation {
  _id: string;
  roomId: string;
  zoneId: string;
  startAtUtc: string;
  endAtUtc: string;
  status: string;
  roomName?: string;
  zoneName?: string;
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  checked_in: 'Checked In',
  completed: 'Completed',
  canceled: 'Canceled',
  expired_no_show: 'No-Show',
};

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'badge-primary',
  checked_in: 'badge-success',
  completed: 'badge-gray',
  canceled: 'badge-danger',
  expired_no_show: 'badge-warning',
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SharedReservationPage() {
  const { token } = useParams<{ token: string }>();
  const [reservation, setReservation] = useState<SharedReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    apiGet<SharedReservation>(`/share-links/${token}`)
      .then((res) => {
        if (res.ok && res.data) {
          setReservation(res.data);
        } else if (res.error?.code === 'NOT_FOUND' || res.error?.code === 'GONE') {
          setNotFound(true);
        } else {
          setError(res.error?.message || 'Failed to load shared reservation');
        }
      })
      .catch(() => {
        setError('An unexpected error occurred');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="loading" style={{ minHeight: '50vh' }}>
        <div className="spinner" />
        Loading shared reservation...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="empty-state" style={{ maxWidth: '480px', margin: '4rem auto' }}>
        <h2>Reservation Not Found</h2>
        <p className="text-gray mt-1">
          This share link may have expired or been revoked.
        </p>
        <Link to="/reservations" className="btn btn-primary mt-4">
          My Reservations
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: '480px', margin: '4rem auto' }}>
        <div className="alert alert-error">{error}</div>
        <Link to="/dashboard" className="btn btn-secondary mt-4">
          Go to Dashboard
        </Link>
      </div>
    );
  }

  if (!reservation) return null;

  return (
    <div style={{ maxWidth: '560px', margin: '2rem auto' }}>
      <div className="card">
        <div style={{ marginBottom: '1rem' }}>
          <p className="text-sm text-gray">This reservation was shared with you</p>
          <h2 style={{ marginTop: '0.25rem' }}>Shared Reservation</h2>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <span className="text-sm text-gray">Room</span>
            <p style={{ fontWeight: 600 }}>
              {reservation.roomName || reservation.roomId}
            </p>
          </div>

          <div>
            <span className="text-sm text-gray">Zone</span>
            <p style={{ fontWeight: 600 }}>
              {reservation.zoneName || reservation.zoneId}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <span className="text-sm text-gray">Start</span>
              <p style={{ fontWeight: 500 }}>{fmt(reservation.startAtUtc)}</p>
            </div>
            <div>
              <span className="text-sm text-gray">End</span>
              <p style={{ fontWeight: 500 }}>{fmt(reservation.endAtUtc)}</p>
            </div>
          </div>

          <div>
            <span className="text-sm text-gray">Status</span>
            <div style={{ marginTop: '0.25rem' }}>
              <span className={`badge ${STATUS_BADGE[reservation.status] || 'badge-gray'}`}>
                {STATUS_LABEL[reservation.status] || reservation.status}
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <Link to="/rooms" className="btn btn-primary btn-sm">
            Book Your Own Room
          </Link>
        </div>
      </div>
    </div>
  );
}
