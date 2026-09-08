import type { RouteNudgeEvent } from "./types";

type Destination = {
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
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
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${lat},${lng}`
  )}`;
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
