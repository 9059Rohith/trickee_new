import { freshnessPresentation, metricText, nudgeAcceptanceLabel, liveNudgePresentation } from "../presentation";

describe("driver-facing presentation", () => {
  it("turns timestamps into actionable live, delayed and offline states", () => {
    const now = Date.parse("2026-09-11T10:00:30Z");
    expect(freshnessPresentation("2026-09-11T10:00:25Z", now)).toEqual({ state: "live", label: "Live - updated 5s ago" });
    expect(freshnessPresentation("2026-09-11T10:00:00Z", now)).toEqual({ state: "delayed", label: "Delayed - updated 30s ago" });
    expect(freshnessPresentation("2026-09-11T09:58:00Z", now)).toEqual({ state: "offline", label: "Offline - last update 2m ago" });
    expect(freshnessPresentation(null, now)).toEqual({ state: "waiting", label: "Waiting for the first GPS update" });
  });

  it("does not turn unavailable evidence into a numeric zero", () => {
    expect(metricText(null, 1, "km")).toBe("Unavailable");
    expect(metricText(0, 1, "km")).toBe("0.0 km");
  });

  it("names acceptance honestly when it only records an outcome", () => {
    expect(nudgeAcceptanceLabel(false)).toBe("Mark accepted");
    expect(nudgeAcceptanceLabel(true)).toBe("Use this route");
  });

  it("distinguishes live route, charger, and SOC alerts without claiming traffic for each", () => {
    expect(liveNudgePresentation("live_route", "google_routes")).toMatchObject({
      label: "TRAFFIC UPDATE", evidence: "Google live traffic used for this route", action: "Open navigation",
    });
    expect(liveNudgePresentation("live_charger", "google_places")).toMatchObject({
      label: "CHARGING OPTION", evidence: "Charger listing from Google Places; availability unconfirmed", action: "Navigate to charger", mapAction: "View charger",
    });
    expect(liveNudgePresentation("live_soc", "unavailable")).toMatchObject({
      label: "BATTERY ALERT", action: "Acknowledge", mapAction: "Open map",
    });
  });
});
