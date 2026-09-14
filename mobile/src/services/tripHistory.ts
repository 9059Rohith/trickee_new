import type { TripDayDetail } from "./types";
import type { MapPolyline } from "../components/OpenStreetMap";

export function localServiceDate(iso: string, timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function tripDurationLabel(start?: string | null, end?: string | null): string {
  if (!start || !end) return "Unavailable";
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return "Unavailable";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export function socUsedLabel(start?: number | null, end?: number | null, eligibilityReason?: string | null): string {
  if (eligibilityReason === "charging_observed") return "Not comparable after charging";
  return typeof start === "number" && typeof end === "number" ? `${(start - end).toFixed(1)}%` : "Unavailable";
}

export function selectedTripPolylines(trips: TripDayDetail[], selectedTripId: string | null): MapPolyline[] {
  return trips
    .filter(trip => (!selectedTripId || trip.id === selectedTripId) && trip.route_trace_available && trip.route_points.length > 0)
    .map((trip, index) => ({
      id: trip.id,
      color: ["#00e5ff", "#ffca20", "#39ff14", "#ff6b6b"][index % 4],
      points: trip.route_points.map(point => ({ latitude: point.latitude, longitude: point.longitude })),
    }));
}
