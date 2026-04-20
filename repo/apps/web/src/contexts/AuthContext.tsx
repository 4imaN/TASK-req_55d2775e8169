import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, setCsrfToken } from '../utils/api';

interface User {
  _id: string;
  username: string;
  displayName: string;
  roles: string[];
  reputationTier: string;
  isActive: boolean;
  phone?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (username: string, password: string, displayName: string, phone?: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
  isCreator: boolean;
  isModerator: boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const result = await apiGet<{ user: User }>('/auth/me');
      if (result.ok && result.data) {
        setUser(result.data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiPost<{ user: User; csrfToken: string }>('/auth/login', { username, password });
    if (result.ok && result.data) {
      setUser(result.data.user);
      if (result.data.csrfToken) setCsrfToken(result.data.csrfToken);
      return { ok: true };
    }
    return { ok: false, error: result.error?.message || 'Login failed' };
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string, phone?: string) => {
    const result = await apiPost<{ user: User; csrfToken: string }>('/auth/register', { username, password, displayName, phone });
    if (result.ok && result.data) {
      setUser(result.data.user);
      if (result.data.csrfToken) setCsrfToken(result.data.csrfToken);
      return { ok: true };
    }
    return { ok: false, error: result.error?.message || 'Registration failed' };
  }, []);

  const logout = useCallback(async () => {
    await apiPost('/auth/logout');
    setUser(null);
  }, []);

  const hasRole = useCallback((role: string) => {
    if (!user) return false;
    if (user.roles.includes('administrator')) return true;
    return user.roles.includes(role);
  }, [user]);

  const isAdmin = user?.roles.includes('administrator') || false;
  const isCreator = hasRole('creator');
  const isModerator = hasRole('moderator');
  const isStaff = isAdmin || isCreator || isModerator;

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, hasRole, isAdmin, isCreator, isModerator, isStaff }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
