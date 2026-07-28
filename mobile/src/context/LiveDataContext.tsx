/**
 * LiveDataContext — polls /mobile/me and exposes GPS-first data.
 *
 * Additions over V4.1:
 * - gps_summary: GPSVehicleSummary from backend
 * - latestSoc: most recent SOC reading
 * - hasBmsSource: false for GPS-model vehicles
 * - Wires GPS tracking start/stop to active trip lifecycle
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { LIVE_POLL_INTERVAL_MS } from "../config";
import { api, ApiError } from "../services/api";
import type {
  Alert,
  Driver,
  GPSVehicleSummary,
  MobileMe,
  Telemetry,
  Vehicle,
} from "../services/types";
import { useAuth } from "./AuthContext";
import { useInterval } from "../hooks/useInterval";
import { startGpsTracking, stopGpsTracking } from "../services/gpsTracking";

type LiveDataValue = {
  me: MobileMe | null;
  alerts: Alert[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
  ackAlert: (alertId: string) => Promise<void>;
  telemetry: Telemetry | null;
  vehicle: Vehicle | null;
  driver: Driver | null;
  // GPS-first additions
  gpsSummary: GPSVehicleSummary | null;
  latestSoc: number | null;
  hasBmsSource: boolean;
};

const LiveDataContext = createContext<LiveDataValue | undefined>(undefined);

export const LiveDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { token, logout, setUser } = useAuth();
  const [me, setMe] = useState<MobileMe | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const appActive = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  const meRef = useRef<MobileMe | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "poll") => {
      if (!token) {
        return;
      }
      if (mode === "poll" && inFlight.current) {
        return;
      }
      const controller = new AbortController();
      inFlight.current = controller;
      if (mode === "refresh") {
        setRefreshing(true);
      }

      try {
        const meResult = await api.mobileMe(token, controller.signal);
        meRef.current = meResult;
        setMe(meResult);
        setAlerts(meResult.alerts || []);
        if (meResult.user) {
          setUser(meResult.user);
        }
        setError(null);
        setLastUpdated(Date.now());
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        if (err instanceof ApiError && err.isAuth) {
          await logout();
          return;
        }
        if (mode !== "poll" || meRef.current === null) {
          setError(
            err instanceof ApiError ? err.message : "Could not load live data."
          );
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
        }
        setLoading(false);
        if (mode === "refresh") {
          setRefreshing(false);
        }
      }
    },
    [token, logout, setUser]
  );

  // Initial load
  useEffect(() => {
    if (token) {
      setLoading(true);
      load("initial");
    } else {
      setMe(null);
      setAlerts([]);
      setLoading(false);
      stopGpsTracking();
    }
    return () => {
      inFlight.current?.abort();
      stopGpsTracking();
    };
  }, [token, load]);

  // GPS tracking tied to active trip
  useEffect(() => {
    let cancelled = false;
    const activeTripId = me?.active_trip?.id;
    const sync = async () => {
      if (token && activeTripId) {
        await startGpsTracking(activeTripId, token);
      } else if (!cancelled) {
        await stopGpsTracking();
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [me?.active_trip?.id, token]);

  // Foreground/background handling
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const wasActive = appActive.current;
      appActive.current = state === "active";
      if (!wasActive && appActive.current && token) {
        load("poll");
      }
    });
    return () => sub.remove();
  }, [token, load]);

  useInterval(
    () => {
      if (appActive.current && token) {
        load("poll");
      }
    },
    token ? LIVE_POLL_INTERVAL_MS : null
  );

  const refresh = useCallback(async () => {
    await load("refresh");
  }, [load]);

  const ackAlert = useCallback(
    async (alertId: string) => {
      if (!token) {
        return;
      }
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      try {
        await api.ackAlert(token, alertId);
      } catch {
        load("poll");
      }
    },
    [token, load]
  );

  const value = useMemo<LiveDataValue>(
    () => ({
      me,
      alerts,
      loading,
      refreshing,
      error,
      lastUpdated,
      refresh,
      ackAlert,
      telemetry: me?.latest_telemetry ?? null,
      vehicle: me?.vehicle ?? null,
      driver: me?.driver ?? null,
      // GPS-first
      gpsSummary: me?.gps_summary ?? null,
      latestSoc: me?.gps_summary?.soc?.value ?? null,
      hasBmsSource: false, // GPS-first model — no BMS
    }),
    [me, alerts, loading, refreshing, error, lastUpdated, refresh, ackAlert]
  );

  return (
    <LiveDataContext.Provider value={value}>
      {children}
    </LiveDataContext.Provider>
  );
};

export function useLiveData() {
  const value = useContext(LiveDataContext);
  if (!value) {
    throw new Error("useLiveData must be inside LiveDataProvider");
  }
  return value;
}
