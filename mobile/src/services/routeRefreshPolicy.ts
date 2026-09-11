export type RouteRefreshSnapshot = {
  latitude: number;
  longitude: number;
  soc: number | null;
  destinationKey: string;
  requestedAtMs: number;
};

const distanceMeters = (a: RouteRefreshSnapshot, b: RouteRefreshSnapshot) => {
  const radiusM = 6_371_000;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export function shouldRefreshRoute(
  previous: RouteRefreshSnapshot | null,
  next: RouteRefreshSnapshot,
  nowMs: number,
  thresholds: { minDistanceM: number; minSocDelta: number; maxAgeMs: number } = {
    minDistanceM: 100,
    minSocDelta: 2,
    maxAgeMs: 30_000,
  }
): boolean {
  if (!previous) return true;
  if (previous.destinationKey !== next.destinationKey) return true;
  if (distanceMeters(previous, next) >= thresholds.minDistanceM) return true;
  if (previous.soc !== next.soc && (previous.soc == null || next.soc == null || Math.abs(previous.soc - next.soc) >= thresholds.minSocDelta)) return true;
  return nowMs - previous.requestedAtMs >= thresholds.maxAgeMs;
}
