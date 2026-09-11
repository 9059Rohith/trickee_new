import type { DailyPlanStop } from "./types";

export type PlannerStop = DailyPlanStop & { local_id: string };
export type PlannerTimeParts = { hour: number; minute: number; period: "AM" | "PM" };

let localStopCounter = 0;

const createPlannerStopId = () => {
  localStopCounter += 1;
  return `planner-stop-${Date.now().toString(36)}-${localStopCounter.toString(36)}`;
};

const parseIsoDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export type PlannerCalendarCell = { iso: string; day: number; inMonth: boolean };

export function monthCells(anchorIso: string): PlannerCalendarCell[] {
  const anchor = parseIsoDate(anchorIso);
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(1 - monthStart.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return { iso: isoDate(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === anchor.getUTCMonth() };
  });
}

export function shiftPlannerMonth(anchorIso: string, delta: number): string {
  const anchor = parseIsoDate(anchorIso);
  return isoDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + delta, 1)));
}

export const plannerMonthLabel = (anchorIso: string) =>
  parseIsoDate(anchorIso).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export const isPastPlannerDate = (candidateIso: string, todayIso: string) => candidateIso < todayIso;

export function addPlannerDays(anchorIso: string, days: number): string {
  const date = parseIsoDate(anchorIso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function canShiftPlannerMonth(anchorIso: string, delta: number, todayIso: string): boolean {
  if (delta >= 0) return true;
  const shifted = shiftPlannerMonth(anchorIso, delta).slice(0, 7);
  return shifted >= todayIso.slice(0, 7);
}

export function plannerDateHeading(serviceDate: string, todayIso: string): string {
  if (serviceDate === todayIso) return "Today's plan";
  if (serviceDate === addPlannerDays(todayIso, 1)) return "Tomorrow's plan";
  return `Plan for ${parseIsoDate(serviceDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })}`;
}

export function ensurePlannerStopIds(
  stops: DailyPlanStop[],
  idFactory: (index: number) => string = () => createPlannerStopId()
): PlannerStop[] {
  const used = new Set<string>();
  return stops.map((stop, index) => {
    let localId = stop.local_id;
    if (!localId || used.has(localId)) {
      localId = idFactory(index);
    }
    used.add(localId);
    return { ...stop, local_id: localId };
  });
}

export function setPlannerStopTime(
  stops: PlannerStop[],
  stopId: string,
  requestedArrivalLocal: string
): PlannerStop[] {
  return stops.map(stop =>
    stop.local_id === stopId
      ? { ...stop, requested_arrival_local: requestedArrivalLocal }
      : stop
  );
}

export function plannerTimeParts(value: string | null | undefined): PlannerTimeParts {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  const hour24 = match ? Math.min(23, Math.max(0, Number(match[1]))) : 9;
  const minute = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0;
  return {
    hour: hour24 % 12 || 12,
    minute,
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

export function toPlannerTime(parts: PlannerTimeParts): string {
  const normalizedHour = Math.min(12, Math.max(1, Math.trunc(parts.hour)));
  const normalizedMinute = Math.min(59, Math.max(0, Math.trunc(parts.minute)));
  const hour24 = normalizedHour % 12 + (parts.period === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

export function addPlannerStop(stops: DailyPlanStop[]): DailyPlanStop[] {
  return stops.length >= 10 ? stops : [...stops, { label: "", requested_arrival_local: null, status: "needs_confirmation" }];
}

export function removePlannerStop(stops: DailyPlanStop[], index: number): DailyPlanStop[] {
  return stops.length <= 1 ? stops : stops.filter((_, itemIndex) => itemIndex !== index);
}

export function movePlannerStop(stops: DailyPlanStop[], index: number, delta: -1 | 1): DailyPlanStop[] {
  const destination = index + delta;
  if (index < 0 || index >= stops.length || destination < 0 || destination >= stops.length) return stops;
  const next = [...stops];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function updatePlannerStop(stops: DailyPlanStop[], index: number, patch: Partial<DailyPlanStop>): DailyPlanStop[] {
  return stops.map((stop, itemIndex) => itemIndex === index ? { ...stop, ...patch } : stop);
}
