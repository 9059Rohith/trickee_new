import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "../services/api";
import type { User } from "../services/types";
import { nativeAuth } from "../services/authNative";
import { googleAuthErrorMessage } from "../services/googleAuthError";
import { SessionRestorer } from "../services/sessionRecovery";

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<string | null>;
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const restorerRef = useRef<SessionRestorer<User> | null>(null);
  if (!restorerRef.current) {
    restorerRef.current = new SessionRestorer<User>({
      load: nativeAuth.load,
      verify: api.me,
      refresh: api.refreshAuth,
      save: nativeAuth.save,
      clear: nativeAuth.clear,
    });
  }

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
          : googleAuthErrorMessage(err);
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
    const restored = await restorerRef.current!.recover();
    if (!restored) {
      const retained = await nativeAuth.load().catch(() => null);
      if (!retained) {
        setToken(null);
        setUserState(null);
      }
      return null;
    }
    setToken(restored.accessToken);
    setUserState(restored.user);
    return restored.accessToken;
  }, []);

  useEffect(() => {
    restore().finally(() => setLoading(false));
  }, [restore]);

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
