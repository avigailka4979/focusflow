// Thin fetch wrapper. All calls go to the same origin under /api; the client's
// nginx (or Vite in development) forwards them to the backend.
const TOKEN_KEY = 'focusflow_token';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ }
  },
  clear: () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, auth = true, keepalive = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, headers, keepalive,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת. בדקו שהמערכת פועלת ונסו שוב.');
  }

  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    const message = (data && typeof data.detail === 'string' && data.detail) || `שגיאה (${res.status})`;
    if (res.status === 401 && auth && token) onUnauthorized(message);
    throw new ApiError(res.status, message);
  }
  return data;
}
