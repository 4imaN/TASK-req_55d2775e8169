import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPut } from '../../utils/api';

interface User {
  _id: string;
  username: string;
  displayName: string;
  roles: string[];
  reputationTier: string;
  isActive: boolean;
  createdAt?: string;
}

const ALL_ROLES = ['creator', 'moderator', 'administrator'];

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === 'administrator' ? 'badge-danger' :
    role === 'moderator' ? 'badge-warning' :
    role === 'creator' ? 'badge-primary' :
    'badge-gray';
  return <span className={`badge ${cls}`} style={{ marginRight: '0.2rem' }}>{role}</span>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [modalRoles, setModalRoles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiGet<User[]>('/users', { page: String(page), pageSize: '20' });
    if (res.ok && res.data) {
      setUsers(res.data);
      setTotal((res.meta as { total?: number })?.total || 0);
    } else {
      setError(res.error?.message || 'Failed to load users');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openRoleModal = (user: User) => {
    setSelectedUser(user);
    setModalRoles([...user.roles]);
    setModalError('');
    setModalSuccess('');
  };

  const closeModal = () => {
    setSelectedUser(null);
    setModalRoles([]);
    setModalError('');
    setModalSuccess('');
  };

  const toggleRole = (role: string) => {
    setModalRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const saveRoles = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    setModalError('');
    setModalSuccess('');
    const res = await apiPut(`/users/${selectedUser._id}/roles`, { roles: modalRoles });
    setSubmitting(false);
    if (res.ok) {
      setModalSuccess('Roles updated successfully.');
      setUsers((prev) =>
        prev.map((u) => (u._id === selectedUser._id ? { ...u, roles: modalRoles } : u))
      );
    } else {
      setModalError(res.error?.message || 'Failed to update roles');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1>Users</h1>
        <span className="text-sm text-gray">{total > 0 ? `${total} total user${total !== 1 ? 's' : ''}` : ''}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {selectedUser && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Assign Roles</h2>
            <p className="text-sm text-gray mb-4">
              User: <strong>{selectedUser.displayName}</strong> (@{selectedUser.username})
            </p>
            {modalError && <div className="alert alert-error">{modalError}</div>}
            {modalSuccess && <div className="alert alert-success">{modalSuccess}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {ALL_ROLES.map((role) => (
                <label key={role} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={modalRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                  />
                  <RoleBadge role={role} />
                  {role}
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRoles} disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Roles'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <h3>No users found</h3>
          <p>Registered users will appear here.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Display Name</th>
                    <th>Roles</th>
                    <th>Reputation</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user._id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          @{user.username}
                        </span>
                      </td>
                      <td><strong>{user.displayName}</strong></td>
                      <td>
                        {user.roles.length > 0
                          ? user.roles.map((r) => <RoleBadge key={r} role={r} />)
                          : <span className="text-gray text-sm">none</span>
                        }
                      </td>
                      <td>
                        <span className="badge badge-gray">{user.reputationTier}</span>
                      </td>
                      <td>
                        <span className={`badge ${user.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openRoleModal(user)}
                        >
                          Roles
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {total > 20 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Prev
              </button>
              <span className="text-sm text-gray">Page {page} of {Math.ceil(total / 20)}</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
