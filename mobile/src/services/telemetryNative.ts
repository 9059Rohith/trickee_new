import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { API_ORIGIN } from "../config";
import { api } from "./api";

type NativeInstallationInfo = {
  installationId: string;
  deviceModel: string;
  appVersion: string;
  platform: "android";
};

export type NativeTelemetryStatus = {
  active: boolean;
  tripId: string | null;
  pendingWindowCount: number;
  collectorState: string;
  stationaryNudgePending: boolean;
  deviceId?: string | null;
  vehicleId?: string | null;
  lastLocation?: { lat: number; lng: number };
};

export type NativeStopResult = {
  tripId: string | null;
  pendingWindowCount: number;
  finalSequenceNo: number;
  collectorState: string;
  lastLocation?: { lat: number; lng: number };
};

export type NativeTelemetryDiagnosticSummary = {
  tripId: string;
  fileName: string;
  finalSequenceNo: number;
  rowCount: number;
  localMissingCount: number;
  pendingCount: number;
  inFlightCount: number;
  ackedCount: number;
  permanentlyRejectedCount: number;
};

export type NativeTelemetryRetryResult = {
  tripId: string;
  eligibleWindowCount: number;
  pendingWindowCount: number;
  permanentlyRejectedCount: number;
};

const nativeTelemetry = NativeModules.TrickeeTelemetry;

type NativePushToken = { configured: boolean; token?: string | null };

function requireAndroidModule() {
  if (Platform.OS !== "android" || !nativeTelemetry) {
    throw new Error(
      "Native trip telemetry is available only in the Android build."
    );
  }
  return nativeTelemetry;
}

async function requestCollectorPermissions(): Promise<void> {
  const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (Number(Platform.Version) >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (
    result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !==
    PermissionsAndroid.RESULTS.GRANTED
  ) {
    throw new Error(
      "Precise foreground location is required to record a trip."
    );
  }
}

async function requestPlannerLocationPermission(): Promise<void> {
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("Precise location is required to calculate the first route.");
  }
}

async function requestReminderPermission(): Promise<void> {
  if (Number(Platform.Version) < 33) return;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
  );
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      "High-priority notification permission is required to schedule departure alerts."
    );
  }
}

export async function ensureTelemetryDevice(
  userToken: string,
  vehicleId: string
): Promise<NativeTelemetryStatus> {
  const module = requireAndroidModule();
  const current = (await module.status()) as NativeTelemetryStatus;
  if (current.deviceId && current.vehicleId === vehicleId) {
    await registerPushNotifications(userToken, current.deviceId).catch(() => undefined);
    return current;
  }
  const info = (await module.installationInfo()) as NativeInstallationInfo;
  const session = await api.registerTelemetryDevice(userToken, {
    installation_id: info.installationId,
    vehicle_id: vehicleId,
    platform: "android",
    device_model: info.deviceModel,
    app_version: info.appVersion,
  });
  await module.registerDevice({
    deviceId: session.device.id,
    vehicleId: session.device.vehicle_id,
    apiOrigin: API_ORIGIN,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });
  await registerPushNotifications(userToken, session.device.id).catch(() => undefined);
  return module.status();
}

export async function registerPushNotifications(
  userToken: string,
  deviceId: string
): Promise<{ configured: boolean; registered: boolean }> {
  await requestReminderPermission();
  const result = (await requireAndroidModule().pushToken()) as NativePushToken;
  if (!result.configured || !result.token) {
    return { configured: false, registered: false };
  }
  await api.registerDevicePushToken(userToken, deviceId, result.token);
  return { configured: true, registered: true };
}

export async function showTestHighPriorityNotification(): Promise<void> {
  await requestReminderPermission();
  await requireAndroidModule().showTestHighPriorityNotification();
}

export async function prepareTelemetryCollector(
  userToken: string,
  vehicleId: string
): Promise<NativeTelemetryStatus> {
  await requestCollectorPermissions();
  return ensureTelemetryDevice(userToken, vehicleId);
}

export async function startTelemetryTrip(
  tripId: string,
  vehicleId: string
): Promise<NativeTelemetryStatus> {
  return requireAndroidModule().startTrip({ tripId, vehicleId });
}

export async function stopTelemetryTrip(): Promise<NativeStopResult> {
  const result = await requireAndroidModule().stopTrip();
  const latitude = Number(result.lastLatitude);
  const longitude = Number(result.lastLongitude);
  return {
    ...result,
    lastLocation:
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { lat: latitude, lng: longitude }
        : undefined,
  };
}

export async function telemetryStatus(): Promise<NativeTelemetryStatus> {
  return requireAndroidModule().status();
}

export async function currentPlannerLocation(): Promise<{
  lat: number;
  lng: number;
}> {
  await requestPlannerLocationPermission();
  const result = await requireAndroidModule().currentLocation();
  const lat = Number(result.lat);
  const lng = Number(result.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("A current GPS location is not available yet.");
  }
  return { lat, lng };
}

export async function scheduleHighPriorityReminder(data: {
  occurrenceId: string;
  title: string;
  body: string;
  dueAtMs: number;
  planId: string;
}): Promise<void> {
  await requestReminderPermission();
  await requireAndroidModule().scheduleHighPriorityReminder(data);
}

export async function acknowledgeStationaryNudge(): Promise<void> {
  await requireAndroidModule().acknowledgeStationaryNudge();
}

export async function exportTelemetryDiagnostics(): Promise<NativeTelemetryDiagnosticSummary> {
  return requireAndroidModule().exportTelemetryDiagnostics();
}

export async function retryPendingTelemetry(): Promise<NativeTelemetryRetryResult> {
  return requireAndroidModule().retryPendingTelemetry();
}
