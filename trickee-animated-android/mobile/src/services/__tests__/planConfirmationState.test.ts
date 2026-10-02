import {
  canConfirmMapSelection,
  confirmationStageLabel,
  type PlanConfirmationStage,
} from "../planConfirmationState";

describe("daily plan confirmation presentation", () => {
  it("names each long-running stage so the driver is never left with an opaque spinner", () => {
    const stages: PlanConfirmationStage[] = ["location", "route_soc", "saving", "reminders"];
    expect(stages.map(confirmationStageLabel)).toEqual([
      "Checking current location",
      "Checking routes and estimating SOC",
      "Saving your plan",
      "Scheduling departure reminders",
    ]);
  });

  it("does not allow an untouched fallback city coordinate to be confirmed", () => {
    expect(canConfirmMapSelection(true, false)).toBe(false);
    expect(canConfirmMapSelection(true, true)).toBe(true);
    expect(canConfirmMapSelection(false, false)).toBe(true);
  });
});
