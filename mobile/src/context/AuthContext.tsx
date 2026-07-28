import AsyncStorage from "@react-native-async-storage/async-storage";
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

const TOKEN_KEY = "trickee.accessToken";

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
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
      await AsyncStorage.setItem(TOKEN_KEY, data.access_token);
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

  const logout = useCallback(async () => {
    const current = token;
    setToken(null);
    setUserState(null);
    setError(null);
    await AsyncStorage.removeItem(TOKEN_KEY);
    if (current) {
      api.logout(current).catch(() => {});
    }
  }, [token]);

  const restore = useCallback(async () => {
    if (restoringRef.current) {
      return token != null;
    }
    restoringRef.current = true;
    try {
      const saved = await AsyncStorage.getItem(TOKEN_KEY);
      if (!saved) {
        return false;
      }
      const me = await api.me(saved);
      setToken(saved);
      setUserState(me);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        await AsyncStorage.removeItem(TOKEN_KEY);
      }
      return false;
    } finally {
      restoringRef.current = false;
    }
  }, [token]);

  const setUser = useCallback((next: User) => setUserState(next), []);
  const value = useMemo(
    () => ({ token, user, loading, error, login, logout, restore, setUser }),
    [token, user, loading, error, login, logout, restore, setUser]
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
