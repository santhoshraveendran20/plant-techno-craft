import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setUnauthorizedHandler, tokenStore } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setSettings(null);
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await api.get("/api/settings");
    setSettings(res.data);
    return res.data;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    const token = tokenStore.get();
    if (!token) {
      setReady(true);
      return;
    }
    Promise.all([api.get("/api/auth/me"), api.get("/api/settings")])
      .then(([me, s]) => {
        setUser(me.data);
        setSettings(s.data);
      })
      .catch(() => tokenStore.set(null))
      .finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(
    async (username, password) => {
      const res = await api.post("/api/auth/login", { username, password });
      tokenStore.set(res.data.access_token);
      setUser(res.data.user);
      await loadSettings();
      return res.data.user;
    },
    [loadSettings]
  );

  const value = useMemo(
    () => ({ user, settings, ready, login, logout, reloadSettings: loadSettings, isOwner: user?.role === "owner" }),
    [user, settings, ready, login, logout, loadSettings]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
