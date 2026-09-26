import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DailyPlan, DailyPlanDraft, RecurringPlanTemplate, RecurringPlanTemplateInput } from "./types";

const PLAN_KEY = "trickee.daily-plan.latest.v1";
const CORRUPT_KEY = "trickee.daily-plan.latest.corrupt.v1";
const FORM_KEY = "trickee.daily-plan.form.v2";
const FORM_CORRUPT_KEY = "trickee.daily-plan.form.corrupt.v2";
const RECURRING_KEY = "trickee.daily-plan.recurring.v1";
const RECURRING_CORRUPT_KEY = "trickee.daily-plan.recurring.corrupt.v1";

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

export async function loadRecurringPlans(): Promise<RecurringPlanTemplate[]> {
  const raw = await AsyncStorage.getItem(RECURRING_KEY);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Recurring plan cache is not an array");
    return value.filter((item): item is RecurringPlanTemplate => (
      item != null &&
      typeof item === "object" &&
      typeof (item as RecurringPlanTemplate).id === "string" &&
      Array.isArray((item as RecurringPlanTemplate).weekdays) &&
      Array.isArray((item as RecurringPlanTemplate).stops)
    ));
  } catch {
    await AsyncStorage.setItem(RECURRING_CORRUPT_KEY, raw);
    return [];
  }
}

export async function saveRecurringPlans(templates: RecurringPlanTemplate[]): Promise<void> {
  await AsyncStorage.setItem(RECURRING_KEY, JSON.stringify(templates));
}

export function buildRecurringTemplateInput(
  plan: DailyPlan,
  name: string,
  weekdays: number[]
): RecurringPlanTemplateInput {
  const cleanName = name.trim();
  const uniqueDays = Array.from(new Set(weekdays)).sort((left, right) => left - right);
  if (plan.status !== "confirmed") throw new Error("Confirm the daily plan before making it recurring.");
  if (!cleanName) throw new Error("Enter a recurring schedule name.");
  if (!uniqueDays.length || uniqueDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Choose at least one valid weekday.");
  }
  const stops = plan.draft.stops.map(stop => {
    if (!stop.label.trim() || !stop.requested_arrival_local || !stop.coordinates) {
      throw new Error("Every recurring stop needs a time and confirmed map location.");
    }
    return {
      label: stop.label.trim(),
      arrival_local_time: stop.requested_arrival_local,
      lat: stop.coordinates.lat,
      lng: stop.coordinates.lng,
    };
  });
  if (!stops.length) throw new Error("Add at least one stop.");
  return {
    name: cleanName,
    timezone: plan.timezone,
    weekdays: uniqueDays,
    starting_soc_pct: plan.starting_soc_pct,
    effective_from: plan.service_date,
    effective_until: null,
    stops,
  };
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
