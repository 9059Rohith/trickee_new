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

export type PlanStartTarget = {
  screen: "trip_start";
  nudgeId: string;
  planId: string;
  legIndex: number;
};

export type NotificationTarget = RouteNudgeTarget | PlanStartTarget;

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

export function parseNotificationTarget(
  data?: Record<string, unknown>
): NotificationTarget | null {
  if (!data || data.url) {
    return null;
  }
  const nudgeId = boundedId(data.nudge_id);
  if (!nudgeId) {
    return null;
  }
  if (data.screen === "trip_start") {
    const planId = boundedId(data.plan_id);
    const legIndex = Number(data.leg_index);
    if (!planId || !Number.isInteger(legIndex) || legIndex < 0 || legIndex > 99) return null;
    return { screen: "trip_start", nudgeId, planId, legIndex };
  }
  if (data.screen !== "route_nudge") return null;
  return {
    screen: "route_nudge",
    nudgeId,
    decisionId: boundedId(data.decision_id),
    plannedTripId: boundedId(data.planned_trip_id),
  };
}

export function parseRouteNudgeTarget(data?: Record<string, unknown>): RouteNudgeTarget | null {
  const target = parseNotificationTarget(data);
  return target?.screen === "route_nudge" ? target : null;
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
  const target = parseNotificationTarget(data);
  if (!target) {
    return null;
  }
  const payload: RouteNudgePayload = {
    screen: target.screen,
    decision_id: target.screen === "route_nudge" ? target.decisionId : undefined,
    planned_trip_id: target.screen === "route_nudge" ? target.plannedTripId : target.planId,
    selected_route_id: optionalString(data.selected_route_id),
    selected_charger_id: optionalString(data.selected_charger_id),
    charger_place_id: optionalString(data.charger_place_id),
    route_name: optionalString(data.route_name),
    leave_at: optionalString(data.leave_at),
    arrival_soc_pct: optionalNumber(data.arrival_soc_pct),
    current_soc_pct: optionalNumber(data.current_soc_pct),
    soc_at_charger_pct: optionalNumber(data.soc_at_charger_pct),
    charger_distance_km: optionalNumber(data.charger_distance_km),
    traffic_delay_s: optionalNumber(data.traffic_delay_s),
    route_duration_s: optionalNumber(data.route_duration_s),
    route_distance_m: optionalNumber(data.route_distance_m),
    route_waypoint_lat: optionalNumber(data.route_waypoint_lat),
    route_waypoint_lng: optionalNumber(data.route_waypoint_lng),
    expires_at: optionalString(data.expires_at),
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
    title: message.notification?.title || optionalString(data.title) || "Route update",
    body:
      message.notification?.body || optionalString(data.body) || "Open Trickee for your route update.",
    payload,
    delivery_status: "sent",
    attempts: 1,
    due_at: optionalString(data.due_at) || new Date().toISOString(),
    outcome: null,
  };
}
