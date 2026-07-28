/**
 * GPS Tracking Service — Active-trip 1Hz capture (§5).
 *
 * - ~1 Hz sampling during active trips via watchPosition
 * - Batch storage with bounded queue (MAX_QUEUE_SIZE)
 * - Periodic sync every SYNC_INTERVAL_MS
 * - Queue overflow protection: drops oldest when at capacity
 * - Per-point sequence counter + app_version / device_model metadata
 * - Foreground-trip-only (no background location permission)
 *
 * NON-NEGOTIABLE: This module captures GPS data. It never fabricates
 * BMS fields (current, voltage, temperature, SOC, SOH).
 */
import { PermissionsAndroid, Platform } from "react-native";
import Geolocation from "react-native-geolocation-service";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import type { GPSRawSample } from "./types";

const APP_VERSION = "2.0.0-gps-first";
const DEVICE_MODEL = Platform.OS === "android" ? "Android" : "iOS";

const BATCH_SIZE_LIMIT = 200;
const MAX_QUEUE_SIZE = 5000; // ~83 min at 1Hz
const SYNC_INTERVAL_MS = 30_000;
const QUEUE_KEY_PREFIX = "trickee.gps_queue.";

let watchId: number | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let activeTripId: string | null = null;
let activeToken: string | null = null;
let sequenceCounter = 0;
let syncInFlight: Promise<boolean> | null = null;
let pointCount = 0;
let lastLocation: { lat: number; lng: number } | null = null;
const pendingEnqueues = new Set<Promise<void>>();
let queueOperation: Promise<void> = Promise.resolve();

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperation.then(operation, operation);
  queueOperation = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function queueKey(tripId?: string | null): string {
  return `${QUEUE_KEY_PREFIX}${tripId || activeTripId || "orphan"}`;
}

async function requestForegroundPermission(): Promise<boolean> {
  if (Platform.OS === "ios") {
    const status = await Geolocation.requestAuthorization("whenInUse");
    return status === "granted";
  }

  const fine = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: "Trickee trip location",
      message:
        "Trickee needs foreground location while a trip is active to estimate energy and efficiency. Tracking stops when you end the trip.",
      buttonPositive: "Allow",
      buttonNegative: "Deny",
    }
  );
  return fine === PermissionsAndroid.RESULTS.GRANTED;
}

async function enqueuePoint(point: GPSRawSample): Promise<void> {
  const key = queueKey();
  return withQueueLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      let queue: GPSRawSample[] = raw ? JSON.parse(raw) : [];

      if (queue.length >= MAX_QUEUE_SIZE) {
        const dropped = queue.length - MAX_QUEUE_SIZE + 1;
        queue = queue.slice(dropped);
        console.warn(`[GPS] Queue overflow: dropped ${dropped} oldest points`);
      }

      queue.push(point);
      await AsyncStorage.setItem(key, JSON.stringify(queue));
    } catch (err) {
      console.error("[GPS] Failed to enqueue point:", err);
    }
  });
}

async function peekAndTakeBatch(tripId: string): Promise<GPSRawSample[]> {
  const key = queueKey(tripId);
  return withQueueLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const queue: GPSRawSample[] = JSON.parse(raw);
      const batch = queue.slice(0, BATCH_SIZE_LIMIT);
      const remaining = queue.slice(BATCH_SIZE_LIMIT);
      await AsyncStorage.setItem(key, JSON.stringify(remaining));
      return batch;
    } catch {
      return [];
    }
  });
}

async function requeueBatch(
  tripId: string,
  batch: GPSRawSample[]
): Promise<void> {
  if (!batch.length) {
    return;
  }
  const key = queueKey(tripId);
  return withQueueLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      const queue: GPSRawSample[] = raw ? JSON.parse(raw) : [];
      const merged = [...batch, ...queue];
      const capped =
        merged.length > MAX_QUEUE_SIZE
          ? merged.slice(merged.length - MAX_QUEUE_SIZE)
          : merged;
      await AsyncStorage.setItem(key, JSON.stringify(capped));
    } catch (err) {
      console.error("[GPS] Failed to requeue batch:", err);
    }
  });
}

function syncBatch(): Promise<boolean> {
  if (syncInFlight) {
    return syncInFlight;
  }
  if (!activeTripId || !activeToken) {
    return Promise.resolve(false);
  }
  const tripId = activeTripId;
  const token = activeToken;

  syncInFlight = (async () => {
    const batch = await peekAndTakeBatch(tripId);
    if (batch.length === 0) {
      return false;
    }

    const batchId = `${tripId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    try {
      await api.uploadGpsBatch(token, tripId, {
        batch_id: batchId,
        points: batch,
      });
      console.log(`[GPS] Synced batch: ${batch.length} points`);
      return true;
    } catch (err) {
      console.error("[GPS] Batch sync failed, re-queuing points:", err);
      await requeueBatch(tripId, batch);
      return false;
    }
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

function onPosition(position: Geolocation.GeoPosition): void {
  sequenceCounter += 1;
  pointCount += 1;

  const point: GPSRawSample = {
    sequence: sequenceCounter,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    timestamp: new Date(position.timestamp).toISOString(),
    altitude: position.coords.altitude ?? undefined,
    accuracy: position.coords.accuracy ?? undefined,
    speed: position.coords.speed ?? undefined,
    heading: position.coords.heading ?? undefined,
    provider: Platform.OS,
    mocked: Boolean((position as any).mocked),
    app_version: APP_VERSION,
    device_model: DEVICE_MODEL,
  };

  lastLocation = { lat: point.lat, lng: point.lng };
  const pending = enqueuePoint(point);
  pendingEnqueues.add(pending);
  pending.finally(() => pendingEnqueues.delete(pending));
}

function onError(error: Geolocation.GeoError): void {
  console.warn("[GPS] Position error:", error.code, error.message);
}

/**
 * Start active-trip GPS tracking at ~1Hz (§5.1).
 * Foreground-only — no background location (§5.2).
 */
export async function startGpsTracking(
  tripId: string,
  token: string
): Promise<void> {
  if (watchId !== null) {
    await stopGpsTracking();
  }

  const granted = await requestForegroundPermission();
  if (!granted) {
    console.warn(
      "[GPS] Foreground location permission denied — tracking not started"
    );
    return;
  }

  activeTripId = tripId;
  activeToken = token;
  sequenceCounter = 0;
  pointCount = 0;
  lastLocation = null;

  console.log(`[GPS] Starting 1Hz tracking for trip: ${tripId}`);

  watchId = Geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    distanceFilter: 0,
    interval: 1000,
    fastestInterval: 500,
    showsBackgroundLocationIndicator: false,
    showLocationDialog: true,
    forceRequestLocation: true,
  });

  syncTimer = setInterval(() => {
    void syncBatch();
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop GPS tracking and flush remaining queue.
 */
export type GpsStopResult = {
  tripId: string | null;
  pointCount: number;
  pendingPointCount: number;
  lastLocation: { lat: number; lng: number } | null;
};

async function queuedPointCount(tripId: string): Promise<number> {
  return withQueueLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(queueKey(tripId));
      return raw ? (JSON.parse(raw) as GPSRawSample[]).length : 0;
    } catch {
      return 0;
    }
  });
}

export async function stopGpsTracking(): Promise<GpsStopResult> {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (syncTimer !== null) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  const tripId = activeTripId;
  const capturedPointCount = pointCount;
  const finalLocation = lastLocation;

  if (pendingEnqueues.size > 0) {
    await Promise.allSettled(Array.from(pendingEnqueues));
  }

  if (tripId && activeToken) {
    console.log(
      `[GPS] Final flush for trip: ${activeTripId}, ${pointCount} total points`
    );
    while (await syncBatch()) {
      // Drain every batch before the backend computes the completed trip.
    }
  }

  const pendingPointCount = tripId ? await queuedPointCount(tripId) : 0;
  if (pendingPointCount === 0) {
    activeTripId = null;
    activeToken = null;
    sequenceCounter = 0;
    pointCount = 0;
  }

  return {
    tripId,
    pointCount: capturedPointCount,
    pendingPointCount,
    lastLocation: finalLocation,
  };
}

export function isTrackingActive(): boolean {
  return watchId !== null;
}

export function getTrackingPointCount(): number {
  return pointCount;
}
