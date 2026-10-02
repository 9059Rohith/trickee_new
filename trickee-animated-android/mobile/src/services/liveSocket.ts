export type LiveStateSnapshot = {
  vehicle_id: string;
  trip_id?: string | null;
  state_version: number;
  sequence_no: number;
  event_time?: string | null;
  received_at?: string | null;
  freshness: string;
  gps_available: boolean;
  location: { lat: number; lng: number } | null;
  health?: Record<string, unknown> | null;
  distance_km?: number;
  projection_status: string;
};

type LiveSocketOptions = {
  origin: string;
  token: string;
  vehicleId: string;
  sinceVersion?: number;
  onSnapshot: (snapshot: LiveStateSnapshot) => void;
};

export function websocketUrl(
  origin: string,
  vehicleId: string,
  sinceVersion: number
): string {
  const socketOrigin = origin
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:")
    .replace(/\/$/, "");
  return `${socketOrigin}/ws/v2/vehicles/${encodeURIComponent(
    vehicleId
  )}?since_version=${Math.max(0, sinceVersion)}`;
}

export function websocketProtocols(token: string): string[] {
  return ["trickee-v2", `trickee-auth.${token}`];
}

export function reconnectDelayMs(
  attempt: number,
  random = Math.random()
): number {
  const base = Math.min(30000, 1000 * 2 ** Math.max(0, Math.min(attempt, 10)));
  return Math.min(
    30000,
    Math.round(base * (1 + Math.max(0, Math.min(random, 1)) * 0.2))
  );
}

export function parseLiveStateMessage(
  raw: string,
  sinceVersion: number
): LiveStateSnapshot | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") {
    return null;
  }
  const envelope = message as { type?: unknown; data?: unknown };
  if (
    !["snapshot", "update"].includes(String(envelope.type)) ||
    !envelope.data ||
    typeof envelope.data !== "object"
  ) {
    return null;
  }
  const data = envelope.data as Partial<LiveStateSnapshot>;
  const location = data.location;
  const validLocation =
    location === null ||
    (!!location &&
      Number.isFinite(location.lat) &&
      location.lat >= -90 &&
      location.lat <= 90 &&
      Number.isFinite(location.lng) &&
      location.lng >= -180 &&
      location.lng <= 180);
  if (
    typeof data.vehicle_id !== "string" ||
    !Number.isInteger(data.state_version) ||
    Number(data.state_version) <= sinceVersion ||
    !Number.isInteger(data.sequence_no) ||
    typeof data.freshness !== "string" ||
    typeof data.gps_available !== "boolean" ||
    typeof data.projection_status !== "string" ||
    !validLocation
  ) {
    return null;
  }
  return data as LiveStateSnapshot;
}

export function connectLiveState(options: LiveSocketOptions): () => void {
  let stopped = false;
  let attempt = 0;
  let sinceVersion = options.sinceVersion ?? 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const clearSocketTimers = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const connect = () => {
    if (stopped) {
      return;
    }
    socket = new WebSocket(
      websocketUrl(options.origin, options.vehicleId, sinceVersion),
      websocketProtocols(options.token)
    );
    socket.onopen = () => {
      attempt = 0;
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 20000);
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const snapshot = parseLiveStateMessage(event.data, sinceVersion);
      if (snapshot) {
        sinceVersion = snapshot.state_version;
        options.onSnapshot(snapshot);
      }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      clearSocketTimers();
      socket = null;
      if (!stopped) {
        reconnectTimer = setTimeout(connect, reconnectDelayMs(attempt++));
      }
    };
  };

  connect();
  return () => {
    stopped = true;
    clearSocketTimers();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const active = socket;
    socket = null;
    active?.close();
  };
}
