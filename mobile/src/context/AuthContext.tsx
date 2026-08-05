import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "../services/api";
import type { User } from "../services/types";
import { nativeAuth } from "../services/authNative";

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<boolean>;
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restoringRef = useRef(false);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.login(email, password);
      await nativeAuth.save({ accessToken: data.access_token });
      setToken(data.access_token);
      setUserState(data.user);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Unable to sign in.";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const googleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const credential = await nativeAuth.googleCredential();
      const data = await api.googleLogin(credential.idToken, credential.nonce);
      await nativeAuth.save({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      });
      setToken(data.access_token);
      setUserState(data.user);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Unable to sign in with Google.";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const current = token;
    const stored = await nativeAuth.load().catch(() => null);
    setToken(null);
    setUserState(null);
    setError(null);
    await nativeAuth.clear();
    if (current && stored?.refreshToken) {
      api.revokeAuth(current, stored.refreshToken).catch(() => {});
    } else if (current) {
      api.logout(current).catch(() => {});
    }
  }, [token]);

  const restore = useCallback(async () => {
    if (restoringRef.current) {
      return token != null;
    }
    restoringRef.current = true;
    try {
      const saved = await nativeAuth.load();
      if (!saved?.accessToken) {
        return false;
      }
      try {
        const me = await api.me(saved.accessToken);
        setToken(saved.accessToken);
        setUserState(me);
      } catch (err) {
        if (!(err instanceof ApiError) || !err.isAuth || !saved.refreshToken) {
          throw err;
        }
        const refreshed = await api.refreshAuth(saved.refreshToken);
        await nativeAuth.save({
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
        });
        setToken(refreshed.access_token);
        setUserState(refreshed.user);
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        await nativeAuth.clear();
      }
      return false;
    } finally {
      restoringRef.current = false;
    }
  }, [token]);

  const setUser = useCallback((next: User) => setUserState(next), []);
  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      error,
      login,
      googleLogin,
      logout,
      restore,
      setUser,
    }),
    [token, user, loading, error, login, googleLogin, logout, restore, setUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be inside AuthProvider");
  }
  return value;
}
