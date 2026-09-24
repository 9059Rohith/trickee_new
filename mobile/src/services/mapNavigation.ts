import type { RouteNudgeEvent } from "./types";

type Destination = {
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
  waypoint_lat?: number | null;
  waypoint_lng?: number | null;
};

export function buildDirectionsUrl(destination: Destination): string | null {
  const lat = Number(destination.lat);
  const lng = Number(destination.lng);
  if (
    destination.lat == null ||
    destination.lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${lat},${lng}`
  )}`;
  if (destination.waypoint_lat == null && destination.waypoint_lng == null) return base;
  const waypointLat = Number(destination.waypoint_lat);
  const waypointLng = Number(destination.waypoint_lng);
  if (destination.waypoint_lat == null || destination.waypoint_lng == null ||
      !Number.isFinite(waypointLat) || !Number.isFinite(waypointLng) ||
      waypointLat < -90 || waypointLat > 90 || waypointLng < -180 || waypointLng > 180) return null;
  return `${base}&waypoints=${encodeURIComponent(`${waypointLat},${waypointLng}`)}`;
}

type LiveActionPayload = Destination & {
  expires_at?: string | null;
  route_waypoint_lat?: number | null;
  route_waypoint_lng?: number | null;
};

export function nudgeNavigationAction(
  nudgeType: string,
  event: RouteNudgeEvent,
  payload: LiveActionPayload & { destination_lat?: number | null; destination_lng?: number | null; route_name?: string | null },
  now = new Date()
): { url?: string; error?: string } {
  const liveNavigation = nudgeType === "live_route" || nudgeType === "live_charger";
  if (event !== "opened" && !(event === "accepted" && liveNavigation)) return {};
  if (liveNavigation && payload.expires_at) {
    const expiry = Date.parse(payload.expires_at);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      return { error: "This live recommendation has expired. Refresh for current guidance." };
    }
  }
  const url = buildDirectionsUrl({
    lat: payload.destination_lat,
    lng: payload.destination_lng,
    label: payload.route_name,
    waypoint_lat: nudgeType === "live_route" ? payload.route_waypoint_lat : null,
    waypoint_lng: nudgeType === "live_route" ? payload.route_waypoint_lng : null,
  });
  return url ? { url } : { error: "This route update has no destination coordinates." };
}

export async function performNudgeAction(
  nudgeType: string,
  event: RouteNudgeEvent,
  payload: LiveActionPayload & { destination_lat?: number | null; destination_lng?: number | null; route_name?: string | null },
  openUrl: (url: string) => Promise<unknown>,
  recordOutcome: () => Promise<unknown>,
  now = new Date()
): Promise<void> {
  const navigation = nudgeNavigationAction(nudgeType, event, payload, now);
  if (navigation.error) throw new Error(navigation.error);
  if (navigation.url) await openUrl(navigation.url);
  await recordOutcome();
}

export function nudgeActionState(event?: RouteNudgeEvent | null): {
  terminal: boolean;
  label: string | null;
} {
  if (event === "accepted") return { terminal: true, label: "Accepted" };
  if (event === "dismissed") return { terminal: true, label: "Dismissed" };
  if (event === "followed") return { terminal: true, label: "Route followed" };
  if (event === "opened") return { terminal: false, label: "Map opened" };
  if (event === "delivered") return { terminal: false, label: "Delivered" };
  return { terminal: false, label: null };
}
