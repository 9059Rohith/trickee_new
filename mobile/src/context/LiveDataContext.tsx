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
import { Features, LIVE_POLL_INTERVAL_MS, WEBSOCKET_ORIGIN } from "../config";
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
import {
  ensureTelemetryDevice,
  startTelemetryTrip,
  stopTelemetryTrip,
} from "../services/telemetryNative";
import { resolveCollectorSync } from "../services/collectorSyncPolicy";
import {
  connectLiveState,
  type LiveStateSnapshot,
} from "../services/liveSocket";

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
  liveState: LiveStateSnapshot | null;
};

const LiveDataContext = createContext<LiveDataValue | undefined>(undefined);

export const LiveDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { token, restore, setUser } = useAuth();
  const [me, setMe] = useState<MobileMe | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [liveState, setLiveState] = useState<LiveStateSnapshot | null>(null);
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
          await restore();
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
    [token, restore, setUser]
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
    }
    return () => {
      inFlight.current?.abort();
    };
  }, [token, load]);

  const liveTripId = me?.active_trip?.id ?? null;
  const liveVehicleId = me?.vehicle?.id ?? null;
  const liveDataResolved = me !== null;

  // GPS tracking follows authoritative trip state but survives unresolved auth/data transitions.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const decision = resolveCollectorSync(
          Boolean(token),
          liveDataResolved,
          liveTripId,
          liveVehicleId
        );
        if (decision.action === "start" && token) {
          await ensureTelemetryDevice(token, decision.vehicleId);
          await startTelemetryTrip(decision.tripId, decision.vehicleId);
        } else if (decision.action === "stop" && !cancelled) {
          await stopTelemetryTrip().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Telemetry collector could not start."
          );
        }
      }
    };
    sync();
    return () => {
      cancelled = true;
    };
  }, [liveDataResolved, liveTripId, liveVehicleId, token]);

  useEffect(() => {
    const vehicleId = me?.vehicle?.id;
    if (!Features.liveWebSocket || !token || !vehicleId) {
      setLiveState(null);
      return;
    }
    return connectLiveState({
      origin: WEBSOCKET_ORIGIN,
      token,
      vehicleId,
      sinceVersion:
        liveState?.vehicle_id === vehicleId ? liveState.state_version : 0,
      onSnapshot: (snapshot) => {
        setLiveState(snapshot);
        setLastUpdated(Date.now());
        setError(null);
      },
    });
    // The socket owns reconnect/version state until identity or vehicle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me?.vehicle?.id]);

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

  const liveTelemetry = useMemo<Telemetry | null>(() => {
    if (!liveState?.gps_available || !liveState.location) {
      return me?.latest_telemetry ?? null;
    }
    return {
      ...(me?.latest_telemetry ?? {}),
      id: `live-${liveState.vehicle_id}-${liveState.state_version}`,
      recorded_at:
        liveState.event_time ||
        liveState.received_at ||
        new Date().toISOString(),
      lat: liveState.location.lat,
      lng: liveState.location.lng,
    };
  }, [liveState, me?.latest_telemetry]);

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
      telemetry: liveTelemetry,
      vehicle: me?.vehicle ?? null,
      driver: me?.driver ?? null,
      // GPS-first
      gpsSummary: me?.gps_summary ?? null,
      latestSoc: me?.gps_summary?.soc?.value ?? null,
      liveState,
      hasBmsSource: false, // GPS-first model — no BMS
    }),
    [
      me,
      alerts,
      loading,
      refreshing,
      error,
      lastUpdated,
      refresh,
      ackAlert,
      liveTelemetry,
      liveState,
    ]
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
