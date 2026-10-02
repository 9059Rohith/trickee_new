export type ActiveTripWait = {
  id: string;
  vehicle_charging: boolean;
  started_at?: string;
};

export type ResumeRequirement = "ask_charging" | "post_charge_soc" | "resume_without_soc";

export function resumeRequirement(wait: ActiveTripWait | null): ResumeRequirement {
  if (!wait) return "ask_charging";
  return wait.vehicle_charging ? "post_charge_soc" : "resume_without_soc";
}
