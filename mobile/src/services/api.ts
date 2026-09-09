/**
 * Trickee GPS-First EV Intelligence — Mobile App
 *
 * API service layer. Every method for GPS batch upload, SOC readings,
 * trip predictions, and vehicle management.
 */
import { API_BASE_URL, API_ORIGIN, REQUEST_TIMEOUT_MS } from "../config";
import type {
  GPSBatchPayload,
  GPSVehicleSummary,
  MobileMe,
  SOCReading,
  SOCReadingRequest,
  TripPrediction,
  Alert,
  RouteNudge,
  RouteNudgeEvent,
  DailyPlan,
  DailyPlanChatResponse,
  DailyPlanStop,
  Vehicle,
  VehicleSpecUpdate,
} from "./types";

export class ApiError extends Error {
  status: number;
  isAuth: boolean;
  isNetwork: boolean;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    this.isAuth = status === 401;
    this.isNetwork = status === 0;
  }
}

async function request<T>(
  method: string,
  path: string,
  token?: string | null,
  body?: any,
  signal?: AbortSignal
): Promise<T> {
  const url = path.startsWith("/api/")
    ? `${API_ORIGIN}${path}`
    : `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const mergedSignal = signal || controller.signal;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: mergedSignal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res
        .json()
        .catch(() => ({ message: res.statusText }));
      throw new ApiError(
        errBody.detail || errBody.message || res.statusText,
        res.status
      );
    }
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError("Network error — could not reach the server.", 0);
  }
}

export const api = {
  // --- Auth ---
  login: (email: string, password: string) =>
    request<{ access_token: string; user: any }>("POST", "/auth/login", null, {
      email,
      password,
    }),

  googleLogin: (idToken: string, nonce: string) =>
    request<{
      access_token: string;
      refresh_token: string;
      user: any;
    }>("POST", "/api/v2/auth/google", null, {
      id_token: idToken,
      nonce,
    }),

  refreshAuth: (refreshToken: string) =>
    request<{ access_token: string; refresh_token: string; user: any }>(
      "POST",
      "/api/v2/auth/refresh",
      null,
      { refresh_token: refreshToken }
    ),

  revokeAuth: (accessToken: string, refreshToken: string) =>
    request<{ logged_out: boolean }>(
      "POST",
      "/api/v2/auth/logout",
      accessToken,
      {
        refresh_token: refreshToken,
      }
    ),

  signup: (email: string, password: string, full_name: string) =>
    request<{ access_token: string; user: any }>("POST", "/auth/signup", null, {
      email,
      password,
      full_name,
    }),

  me: (token: string) => request<any>("GET", "/auth/me", token),

  logout: (token: string) => request<any>("POST", "/auth/logout", token),

  registerTelemetryDevice: (
    token: string,
    data: {
      installation_id: string;
      vehicle_id: string;
      platform: "android";
      device_model: string;
      app_version: string;
    }
  ) =>
    request<{
      device: { id: string; vehicle_id: string };
      access_token: string;
      refresh_token: string;
    }>("POST", "/api/v2/devices/register", token, data),

  completeTelemetryTrip: (
    token: string,
    tripId: string,
    data: {
      ending_soc: number;
      final_sequence_no: number;
      location?: { lat: number; lng: number };
      idempotency_key: string;
    }
  ) => request<any>("POST", `/api/v2/trips/${tripId}/complete`, token, data),

  getTelemetryTripStatus: (token: string, tripId: string) =>
    request<any>("GET", `/api/v2/trips/${tripId}`, token),

  ownerSummary: (token: string, signal?: AbortSignal) =>
    request<{
      totals: {
        vehicles: number;
        trips: number;
        distance_km: number;
        route_energy_kwh: number;
      };
      vehicles: Array<{
        vehicle_id: string;
        vehicle_code: string;
        spec_incomplete: boolean;
        completed_trips: number;
        distance_km: number;
        route_energy_kwh: number;
        latest_prediction: GPSVehicleSummary["latest_prediction"] | null;
        soc: GPSVehicleSummary["soc"] | null;
        estimated_range_km: number | null;
        range_available: boolean;
      }>;
      calculation_basis: string;
      range_policy: string;
    }>("GET", "/owner/summary", token, undefined, signal),

  // --- Mobile ---
  mobileMe: (token: string, signal?: AbortSignal) =>
    request<MobileMe>("GET", "/mobile/me", token, undefined, signal),

  mobileAlerts: (
    token: string,
    params?: { limit?: number },
    signal?: AbortSignal
  ) =>
    request<Alert[]>(
      "GET",
      `/mobile/alerts?limit=${params?.limit || 50}`,
      token,
      undefined,
      signal
    ),

  ackAlert: (token: string, alertId: string) =>
    request<any>("POST", `/mobile/alerts/${alertId}/ack`, token),

  listRouteNudges: (token: string, limit = 50, signal?: AbortSignal) =>
    request<RouteNudge[]>(
      "GET",
      `/route-nudges/inbox?limit=${Math.max(1, Math.min(limit, 100))}`,
      token,
      undefined,
      signal
    ),

  recordRouteNudgeOutcome: (
    token: string,
    nudgeId: string,
    data: {
      event: RouteNudgeEvent;
      occurred_at: string;
      selected_route_id?: string;
      selected_charger_id?: string;
      metadata?: Record<string, unknown>;
    }
  ) => request<any>("POST", `/route-nudges/${nudgeId}/outcome`, token, data),

  createDailyPlanDraft: (
    token: string,
    data: {
      message: string;
      service_date: string;
      timezone: string;
      starting_soc_pct: number;
    }
  ) => request<DailyPlanChatResponse>("POST", "/daily-plans/chat", token, data),

  confirmDailyPlan: (
    token: string,
    planId: string,
    data: {
      confirmation_key: string;
      origin: { lat: number; lng: number };
      stops?: Array<Pick<DailyPlanStop, "label" | "requested_arrival_local" | "coordinates">>;
    }
  ) => request<DailyPlan>("POST", `/daily-plans/${planId}/confirm`, token, data),

  getDailyPlan: (token: string, planId: string) =>
    request<DailyPlan>("GET", `/daily-plans/${planId}`, token),

  // --- Trips ---
  startTrip: (
    token: string,
    data: {
      vehicle_id: string;
      destination_text?: string;
      starting_soc?: number;
      origin?: { lat: number; lng: number };
      idempotency_key: string;
    }
  ) => request<any>("POST", "/api/v2/trips/start", token, data),

  endTrip: (
    token: string,
    data: {
      ending_soc: number;
      location?: { lat: number; lng: number };
      idempotency_key?: string;
    }
  ) => request<any>("POST", "/mobile/trips/end", token, data),

  // --- GPS Batch Upload (§6.1) ---
  uploadGpsBatch: (token: string, tripId: string, payload: GPSBatchPayload) =>
    request<{ batch_id: string; inserted: number }>(
      "POST",
      `/mobile/v2/trips/${tripId}/gps-batch`,
      token,
      payload
    ),

  // --- SOC Readings ---
  recordSocReading: (token: string, data: SOCReadingRequest) =>
    request<SOCReading>("POST", "/soc/readings", token, data),

  getLatestSoc: (token: string, vehicleId: string) =>
    request<SOCReading | null>(
      "GET",
      `/soc/vehicles/${vehicleId}/latest`,
      token
    ),

  getSocHistory: (token: string, vehicleId: string, limit = 20) =>
    request<SOCReading[]>(
      "GET",
      `/soc/vehicles/${vehicleId}/history?limit=${limit}`,
      token
    ),

  // --- GPS Intelligence ---
  getTripPrediction: (token: string, tripId: string) =>
    request<TripPrediction>("GET", `/gps/trips/${tripId}/prediction`, token),

  triggerPrediction: (token: string, tripId: string) =>
    request<TripPrediction>("POST", `/gps/trips/${tripId}/compute`, token),

  getVehicleGpsSummary: (token: string, vehicleId: string) =>
    request<GPSVehicleSummary>(
      "GET",
      `/gps/vehicles/${vehicleId}/summary`,
      token
    ),

  // --- Vehicles ---
  listVehicles: (token: string) =>
    request<Vehicle[]>("GET", "/vehicles/", token),

  getVehicle: (token: string, vehicleId: string) =>
    request<Vehicle>("GET", `/vehicles/${vehicleId}`, token),

  createVehicle: (token: string, data: any) =>
    request<Vehicle>("POST", "/vehicles/", token, data),

  updateVehicleSpecs: (
    token: string,
    vehicleId: string,
    data: VehicleSpecUpdate
  ) => request<Vehicle>("PATCH", `/vehicles/${vehicleId}/specs`, token, data),

  driverTrips: (
    token: string,
    driverId: string,
    limit = 50,
    signal?: AbortSignal
  ) =>
    request<any[]>(
      "GET",
      `/drivers/${driverId}/trips?limit=${limit}`,
      token,
      undefined,
      signal
    ),

  recommendChargers: (token: string, data: any, signal?: AbortSignal) =>
    request<any>("POST", "/chargers/recommend", token, data, signal),

  assistantMessage: (token: string, data: any) =>
    request<any>("POST", "/assistant/message", token, data),

  registerDevicePushToken: (token: string, deviceId: string, pushToken: string) =>
    request<any>("PUT", `/api/v2/devices/${deviceId}/push-token`, token, {
      token: pushToken,
    }),

  transcribeVoice: async (
    _token: string,
    _fileUri: string
  ): Promise<string> => {
    throw new ApiError(
      "Voice transcription is not enabled for this build.",
      501
    );
  },
};
