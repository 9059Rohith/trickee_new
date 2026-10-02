import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DailyPlan, DailyPlanDraft } from "./types";

const PLAN_KEY = "trickee.daily-plan.latest.v1";
const CORRUPT_KEY = "trickee.daily-plan.latest.corrupt.v1";
const FORM_KEY = "trickee.daily-plan.form.v2";
const FORM_CORRUPT_KEY = "trickee.daily-plan.form.corrupt.v2";

export type PlannerLocalDraft = {
  version: 2;
  message: string;
  service_date: string;
  starting_soc: string;
  plan: DailyPlan | null;
  saved_at: string;
};

const isPlannerLocalDraft = (value: unknown): value is PlannerLocalDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlannerLocalDraft>;
  return draft.version === 2 &&
    typeof draft.message === "string" &&
    typeof draft.service_date === "string" &&
    typeof draft.starting_soc === "string" &&
    typeof draft.saved_at === "string" &&
    (draft.plan === null || (typeof draft.plan === "object" && typeof draft.plan?.id === "string"));
};

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

export async function loadPlannerLocalDraft(): Promise<PlannerLocalDraft | null> {
  const raw = await AsyncStorage.getItem(FORM_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isPlannerLocalDraft(value) ? value : null;
  } catch {
    await AsyncStorage.setItem(FORM_CORRUPT_KEY, raw);
    return null;
  }
}

export async function savePlannerLocalDraft(draft: PlannerLocalDraft): Promise<void> {
  await AsyncStorage.setItem(FORM_KEY, JSON.stringify(draft));
}

export async function discardPlannerLocalDraft(): Promise<void> {
  await AsyncStorage.removeItem(FORM_KEY);
}

export function validateDailyPlanDraft(
  draft: DailyPlanDraft
): { valid: boolean; reason: string | null } {
  if (!draft.stops.length) {
    return { valid: false, reason: "Add at least one stop." };
  }
  if (
    draft.stops.length > 10 ||
    draft.stops.some(
      (stop) =>
        !stop.label.trim() ||
        !stop.requested_arrival_local ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(stop.requested_arrival_local)
    )
  ) {
    return {
      valid: false,
      reason: "Add a time for every stop before confirming.",
    };
  }
  return { valid: true, reason: null };
}
