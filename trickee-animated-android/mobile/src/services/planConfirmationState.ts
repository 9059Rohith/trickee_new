export type PlanConfirmationStage = "location" | "route_soc" | "saving" | "reminders";

export function confirmationStageLabel(stage: PlanConfirmationStage): string {
  switch (stage) {
    case "location":
      return "Checking current location";
    case "route_soc":
      return "Checking routes and estimating SOC";
    case "saving":
      return "Saving your plan";
    case "reminders":
      return "Scheduling departure reminders";
  }
}

export const canConfirmMapSelection = (fallbackUsed: boolean, hasMoved: boolean) =>
  !fallbackUsed || hasMoved;
