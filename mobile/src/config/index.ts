import { NativeModules, Platform } from "react-native";
import { resolveBackendConfig } from "./backendConfig";

const NATIVE_API_ORIGIN = NativeModules.TrickeeTelemetry?.apiOrigin as
  | string
  | undefined;
const NATIVE_WEBSOCKET_ORIGIN = NativeModules.TrickeeTelemetry
  ?.websocketOrigin as string | undefined;

const BACKEND = resolveBackendConfig(
  __DEV__,
  Platform.OS,
  NATIVE_API_ORIGIN,
  NATIVE_WEBSOCKET_ORIGIN
);
const USE_HOSTED_BACKEND = BACKEND.useHostedBackend;

export const API_ORIGIN = BACKEND.apiOrigin;
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;
export const WEBSOCKET_ORIGIN = BACKEND.websocketOrigin;
export const REQUEST_TIMEOUT_MS = 60000;
export const LIVE_POLL_INTERVAL_MS = 15000;
export const DEFAULT_MAP_CENTER = { latitude: 21.1702, longitude: 72.8311 };

export const Features = {
  passwordLogin: __DEV__,
  liveWebSocket: true,
  driverActions: true,
  gpsFirstModel: true,
};

export const DEMO_LOGINS = USE_HOSTED_BACKEND
  ? []
  : [
      {
        label: "Driver (Ravi)",
        email: "driver1@evify.in",
        password: "Driver@2026",
      },
      {
        label: "Driver (Priya)",
        email: "driver2@evify.in",
        password: "Driver@2026",
      },
      {
        label: "Fleet Manager",
        email: "owner@evify.in",
        password: "Manager@2026",
      },
    ];
export const SHOW_DEMO_LOGINS = !USE_HOSTED_BACKEND;
