import type { RouteNudge, RouteNudgePayload } from "./types";

type RemoteMessage = {
  notification?: { title?: string; body?: string };
  data?: Record<string, unknown>;
};

export type RouteNudgeTarget = {
  screen: "route_nudge";
  nudgeId: string;
  decisionId?: string;
  plannedTripId?: string;
};

function boundedId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) {
    return undefined;
  }
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "None" && value !== "null"
    ? value
    : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

export function parseRouteNudgeTarget(
  data?: Record<string, unknown>
): RouteNudgeTarget | null {
  if (!data || data.url || data.screen !== "route_nudge") {
    return null;
  }
  const nudgeId = boundedId(data.nudge_id);
  if (!nudgeId) {
    return null;
  }
  return {
    screen: "route_nudge",
    nudgeId,
    decisionId: boundedId(data.decision_id),
    plannedTripId: boundedId(data.planned_trip_id),
  };
}

export function mergeRouteNudges(
  local: RouteNudge[],
  remote: RouteNudge[]
): RouteNudge[] {
  const byId = new Map(local.map((item) => [item.id, item]));
  remote.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values()).sort(
    (left, right) => Date.parse(right.due_at) - Date.parse(left.due_at)
  );
}

export function routeNudgeFromRemoteMessage(
  message: RemoteMessage
): RouteNudge | null {
  const data = message.data || {};
  const target = parseRouteNudgeTarget(data);
  if (!target) {
    return null;
  }
  const payload: RouteNudgePayload = {
    screen: "route_nudge",
    decision_id: target.decisionId,
    planned_trip_id: target.plannedTripId,
    selected_route_id: optionalString(data.selected_route_id),
    selected_charger_id: optionalString(data.selected_charger_id),
    route_name: optionalString(data.route_name),
    leave_at: optionalString(data.leave_at),
    arrival_soc_pct: optionalNumber(data.arrival_soc_pct),
    provider_source: optionalString(data.provider_source),
    confidence: optionalNumber(data.confidence),
    degraded_reason: optionalString(data.degraded_reason),
    destination_lat: optionalNumber(data.destination_lat),
    destination_lng: optionalNumber(data.destination_lng),
    place_confirmed: optionalBoolean(data.place_confirmed),
    availability_confirmed: optionalBoolean(data.availability_confirmed),
  };
  return {
    id: target.nudgeId,
    nudge_type: optionalString(data.nudge_type) || "departure",
    title: message.notification?.title || "Route update",
    body:
      message.notification?.body || "Open Trickee for your route update.",
    payload,
    delivery_status: "sent",
    attempts: 1,
    due_at: optionalString(data.due_at) || new Date().toISOString(),
    outcome: null,
  };
}
