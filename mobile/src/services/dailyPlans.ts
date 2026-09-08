import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DailyPlan, DailyPlanDraft } from "./types";

const PLAN_KEY = "trickee.daily-plan.latest.v1";
const CORRUPT_KEY = "trickee.daily-plan.latest.corrupt.v1";

export async function loadDailyPlan(): Promise<DailyPlan | null> {
  const raw = await AsyncStorage.getItem(PLAN_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value.id === "string" ? value : null;
  } catch {
    await AsyncStorage.setItem(CORRUPT_KEY, raw);
    return null;
  }
}

export async function saveDailyPlan(plan: DailyPlan): Promise<void> {
  await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}

export function validateDailyPlanDraft(
  draft: DailyPlanDraft
): { valid: boolean; reason: string | null } {
  if (!draft.stops.length) {
    return { valid: false, reason: "Add at least one stop." };
  }
  if (
    draft.warnings.length > 0 ||
    draft.stops.some((stop) => !stop.requested_arrival_local)
  ) {
    return {
      valid: false,
      reason: "Add a time for every stop before confirming.",
    };
  }
  return { valid: true, reason: null };
}
