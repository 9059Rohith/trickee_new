import type { DailyPlan, DailyPlanLeg } from "./types";

export type RequestedPlanLeg = { planId: string; legIndex: number };

export type SelectedPlanLeg = {
  planId: string;
  legIndex: number;
  destination: { text: string; lat: number; lng: number };
  plannedDepartureAt: string | null;
  plannedArrivalAt: string | null;
  arrivalSocPct: number | null;
  selectionSource: "requested" | "next_available";
  fallbackReason: "requested_leg_unavailable" | null;
};

const terminalStatuses = new Set(["arrived", "skipped", "ended_elsewhere"]);

function dateInTimezone(now: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return null;
  }
}

function candidate(plan: DailyPlan, leg: DailyPlanLeg): SelectedPlanLeg | null {
  const coordinates = leg.destination.coordinates;
  const text = (leg.destination.name || leg.destination.query || "").trim();
  if (
    terminalStatuses.has(leg.status || "") ||
    !text ||
    coordinates == null ||
    !Number.isFinite(coordinates.lat) ||
    !Number.isFinite(coordinates.lng)
  ) return null;
  return {
    planId: plan.id,
    legIndex: leg.index,
    destination: { text, lat: coordinates.lat, lng: coordinates.lng },
    plannedDepartureAt: leg.planned_departure_at,
    plannedArrivalAt: leg.estimated_arrival_at,
    arrivalSocPct: leg.arrival_soc_pct,
    selectionSource: "next_available",
    fallbackReason: null,
  };
}

export function selectNextPlanLeg(
  plans: DailyPlan[],
  now: Date,
  requested?: RequestedPlanLeg
): SelectedPlanLeg | null {
  const candidates = plans.flatMap((plan) => {
    if (
      plan.status !== "confirmed" ||
      plan.result == null ||
      dateInTimezone(now, plan.timezone) !== plan.service_date
    ) return [];
    return plan.result.legs.map((leg) => candidate(plan, leg)).filter((leg): leg is SelectedPlanLeg => leg != null);
  });

  if (requested) {
    const selected = candidates.find(
      (leg) => leg.planId === requested.planId && leg.legIndex === requested.legIndex
    );
    if (selected) return { ...selected, selectionSource: "requested" };
  }
  candidates.sort((left, right) => {
    const leftTime = left.plannedDepartureAt ? Date.parse(left.plannedDepartureAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.plannedDepartureAt ? Date.parse(right.plannedDepartureAt) : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.legIndex - right.legIndex;
  });
  const selected = candidates[0];
  return selected
    ? { ...selected, fallbackReason: requested ? "requested_leg_unavailable" : null }
    : null;
}

export function nextLegPresentation(plan: DailyPlan, now = new Date()) {
  const selected = selectNextPlanLeg([plan], now);
  if (!selected) return null;
  const arrival = plan.result?.legs.find((leg) => leg.index === selected.legIndex)?.requested_arrival_local;
  const soc = selected.arrivalSocPct == null ? "Arrival SOC unavailable" : `Estimated ${Math.round(selected.arrivalSocPct)}% SOC`;
  return {
    title: `Next: ${selected.destination.text}`,
    subtitle: `${arrival ? `Planned arrival ${arrival}` : "Arrival time unavailable"} · ${soc}`,
    planId: selected.planId,
    legIndex: selected.legIndex,
    destination: selected.destination,
  };
}
