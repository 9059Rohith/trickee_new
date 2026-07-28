import { Platform } from "react-native";

const HOSTED_API_ORIGIN = "https://trickee-gps-first.onrender.com";
const USE_HOSTED_BACKEND = !__DEV__;

const LOCAL_API_ORIGIN =
  Platform.OS === "android" ? "http://10.0.2.2:8001" : "http://127.0.0.1:8001";

export const API_ORIGIN = USE_HOSTED_BACKEND
  ? HOSTED_API_ORIGIN
  : LOCAL_API_ORIGIN;
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;
export const REQUEST_TIMEOUT_MS = 60000;
export const LIVE_POLL_INTERVAL_MS = 15000;
export const DEFAULT_MAP_CENTER = { latitude: 21.1702, longitude: 72.8311 };

export const Features = {
  passwordLogin: true,
  liveWebSocket: false,
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
