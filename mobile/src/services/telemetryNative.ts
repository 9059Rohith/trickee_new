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

export async function ensureTelemetryDevice(
  userToken: string,
  vehicleId: string
): Promise<NativeTelemetryStatus> {
  const module = requireAndroidModule();
  const current = (await module.status()) as NativeTelemetryStatus;
  if (current.deviceId && current.vehicleId === vehicleId) {
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
  return module.status();
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

export async function acknowledgeStationaryNudge(): Promise<void> {
  await requireAndroidModule().acknowledgeStationaryNudge();
}

export async function exportTelemetryDiagnostics(): Promise<NativeTelemetryDiagnosticSummary> {
  return requireAndroidModule().exportTelemetryDiagnostics();
}

export async function retryPendingTelemetry(): Promise<NativeTelemetryRetryResult> {
  return requireAndroidModule().retryPendingTelemetry();
}
