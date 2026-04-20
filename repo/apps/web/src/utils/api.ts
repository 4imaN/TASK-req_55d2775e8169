const API_BASE = '/api/v1';

let csrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.data.csrfToken;
  return csrfToken!;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; meta?: Record<string, unknown> }> {
  const method = options.method?.toUpperCase() || 'GET';

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  // Add CSRF token for mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!csrfToken) {
      await fetchCsrfToken();
    }
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
  }

  // Add content-type for JSON bodies
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const json = await res.json();

  if (!json.ok) {
    return { ok: false, error: json.error, meta: json.meta };
  }

  return { ok: true, data: json.data, meta: json.meta };
}

export async function apiGet<T = unknown>(path: string, params?: Record<string, string>): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; meta?: Record<string, unknown> }> {
  const url = params ? `${path}?${new URLSearchParams(params)}` : path;
  return api<T>(url);
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; meta?: Record<string, unknown> }> {
  return api<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut<T = unknown>(path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; meta?: Record<string, unknown> }> {
  return api<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete<T = unknown>(path: string): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; meta?: Record<string, unknown> }> {
  return api<T>(path, { method: 'DELETE' });
}
