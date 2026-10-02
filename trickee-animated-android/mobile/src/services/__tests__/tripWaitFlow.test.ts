import { resumeRequirement } from "../tripWaitFlow";

describe("same-trip waiting flow", () => {
  it("asks whether the vehicle is charging when a stationary trip is not yet waiting", () => {
    expect(resumeRequirement(null)).toBe("ask_charging");
  });

  it("requires a post-charge dashboard SOC before resuming a charging wait", () => {
    expect(resumeRequirement({ id: "wait-1", vehicle_charging: true })).toBe("post_charge_soc");
  });

  it("resumes an uncharged wait without asking for another SOC", () => {
    expect(resumeRequirement({ id: "wait-1", vehicle_charging: false })).toBe("resume_without_soc");
  });
});
