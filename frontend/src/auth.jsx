import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler, tokenStore } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const dropSession = useCallback((message) => {
    tokenStore.clear();
    setUser(null);
    navigate('/login', { replace: true, state: message ? { notice: message } : undefined });
  }, [navigate]);

  useEffect(() => { setUnauthorizedHandler(dropSession); }, [dropSession]);

  // Restore the session after a page refresh.
  useEffect(() => {
    if (!tokenStore.get()) return;
    api('/users/me')
      .then(setUser)
      .catch(() => { tokenStore.clear(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    tokenStore.set(res.access_token);
    const me = await api('/users/me');
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async (notice) => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* token may already be invalid */ }
    tokenStore.clear();
    setUser(null);
    navigate('/login', { replace: true, state: notice ? { notice } : undefined });
  }, [navigate]);

  const value = useMemo(() => ({ user, setUser, loading, login, logout, dropSession }),
    [user, loading, login, logout, dropSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
