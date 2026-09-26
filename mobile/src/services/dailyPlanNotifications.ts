import type { DailyPlan } from "./types";
import { scheduleHighPriorityReminder } from "./telemetryNative";

export function planLegOccurrenceId(planId: string, legIndex: number): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(planId)) throw new Error("Invalid plan identifier");
  if (!Number.isInteger(legIndex) || legIndex < 0 || legIndex > 99) throw new Error("Invalid leg index");
  return `${planId}-leg-${legIndex}`;
}

export async function schedulePlanReminders(
  plan: DailyPlan,
  nowMs = Date.now()
): Promise<{ scheduled: number; skipped: number }> {
  let scheduled = 0;
  let skipped = 0;
  for (const leg of plan.result?.legs || []) {
    const departureMs = leg.planned_departure_at
      ? Date.parse(leg.planned_departure_at)
      : Number.NaN;
    const dueAtMs = departureMs - 15 * 60 * 1000;
    if (!Number.isFinite(dueAtMs) || dueAtMs <= nowMs) {
      skipped += 1;
      continue;
    }
    const destination = leg.destination.name || leg.destination.query || "your stop";
    const socText =
      leg.arrival_soc_pct == null
        ? "Arrival SOC is unavailable."
        : `Estimated arrival SOC ${leg.arrival_soc_pct.toFixed(1)}%.`;
    await scheduleHighPriorityReminder({
      occurrenceId: planLegOccurrenceId(plan.id, leg.index),
      title: `Leave soon for ${destination}`,
      body: `${socText} Open Trickee for route details.`,
      dueAtMs,
      planId: plan.id,
      legIndex: leg.index,
    });
    scheduled += 1;
  }
  return { scheduled, skipped };
}
