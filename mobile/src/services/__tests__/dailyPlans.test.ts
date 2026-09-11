jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  discardPlannerLocalDraft,
  loadDailyPlan,
  loadPlannerLocalDraft,
  saveDailyPlan,
  savePlannerLocalDraft,
  validateDailyPlanDraft,
} from "../dailyPlans";

describe("daily plan storage and validation", () => {
  beforeEach(async () => AsyncStorage.clear());

  it("round trips the latest plan without touching telemetry storage", async () => {
    const plan = {
      id: "plan-1", driver_id: "driver-1", vehicle_id: "vehicle-1",
      service_date: "2026-09-09", timezone: "Asia/Kolkata", starting_soc_pct: 80,
      status: "draft" as const,
      draft: {service_date: "2026-09-09", timezone: "Asia/Kolkata", parser_source: "deterministic_schedule_parser", warnings: [], stops: [{label: "Office", requested_arrival_local: "09:00", status: "unresolved"}]},
      result: null,
    };

    await saveDailyPlan(plan);
    await expect(loadDailyPlan()).resolves.toEqual(plan);
  });

  it("blocks confirmation when a stop has no time", () => {
    expect(validateDailyPlanDraft({service_date: "2026-09-09", timezone: "Asia/Kolkata", parser_source: "deterministic_schedule_parser", warnings: ["time needed"], stops: [{label: "Client", requested_arrival_local: null, status: "needs_confirmation"}]})).toEqual({valid: false, reason: "Add a time for every stop before confirming."});
  });

  it("restores the complete planner form without treating it as server-confirmed", async () => {
    const localDraft = {
      version: 2 as const,
      message: "Office at 9 and home at 7",
      service_date: "2026-09-12",
      starting_soc: "82",
      plan: null,
      saved_at: "2026-09-11T10:00:00.000Z",
    };

    await savePlannerLocalDraft(localDraft);
    await expect(loadPlannerLocalDraft()).resolves.toEqual(localDraft);
  });

  it("discards only the editable planner form", async () => {
    await savePlannerLocalDraft({
      version: 2,
      message: "Client at 2",
      service_date: "2026-09-12",
      starting_soc: "70",
      plan: null,
      saved_at: "2026-09-11T10:00:00.000Z",
    });
    await discardPlannerLocalDraft();
    await expect(loadPlannerLocalDraft()).resolves.toBeNull();
  });

  it("quarantines malformed planner form state instead of crashing", async () => {
    await AsyncStorage.setItem("trickee.daily-plan.form.v2", "not-json");
    await expect(loadPlannerLocalDraft()).resolves.toBeNull();
    await expect(AsyncStorage.getItem("trickee.daily-plan.form.corrupt.v2")).resolves.toBe("not-json");
  });
});
