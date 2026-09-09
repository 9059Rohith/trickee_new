import type { DailyPlanStop } from "./types";

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
