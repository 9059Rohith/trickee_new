jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadDailyPlan, saveDailyPlan, validateDailyPlanDraft } from "../dailyPlans";

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
});
