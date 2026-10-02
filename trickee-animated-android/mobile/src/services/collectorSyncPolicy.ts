export type CollectorSyncDecision =
  | { action: "none" }
  | { action: "stop" }
  | { action: "start"; tripId: string; vehicleId: string };

/** Keeps durable native capture alive until the backend explicitly reports an idle driver. */
export function resolveCollectorSync(
  authenticated: boolean,
  dataLoaded: boolean,
  activeTripId: string | null,
  vehicleId: string | null
): CollectorSyncDecision {
  if (!authenticated || !dataLoaded) return { action: "none" };
  if (activeTripId && vehicleId) {
    return { action: "start", tripId: activeTripId, vehicleId };
  }
  if (!activeTripId) return { action: "stop" };
  return { action: "none" };
}
