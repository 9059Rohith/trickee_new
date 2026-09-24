import {
  buildDirectionsUrl,
  nudgeActionState,
  nudgeNavigationAction,
  performNudgeAction,
} from "../mapNavigation";

describe("route nudge map and action behavior", () => {
  it("builds a universally handled HTTPS directions URL", () => {
    expect(
      buildDirectionsUrl({ lat: 21.171, lng: 72.831, label: "Ring Road charger" })
    ).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=21.171%2C72.831"
    );
  });

  it("does not claim a map action when coordinates are missing", () => {
    expect(buildDirectionsUrl({ lat: null, lng: null })).toBeNull();
  });

  it("turns accepted and dismissed outcomes into visible terminal states", () => {
    expect(nudgeActionState("accepted")).toEqual({
      terminal: true,
      label: "Accepted",
    });
    expect(nudgeActionState("dismissed")).toEqual({
      terminal: true,
      label: "Dismissed",
    });
    expect(nudgeActionState("opened")).toEqual({
      terminal: false,
      label: "Map opened",
    });
  });

  it("passes a valid intermediate waypoint for the suggested alternate", () => {
    expect(buildDirectionsUrl({ lat: 12.99, lng: 77.61, waypoint_lat: 12.98, waypoint_lng: 77.6 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=12.99%2C77.61&waypoints=12.98%2C77.6"
    );
    expect(buildDirectionsUrl({ lat: 12.99, lng: 77.61, waypoint_lat: 999, waypoint_lng: 77.6 })).toBeNull();
  });

  it("requires a fresh destination before accepting a live route or charger recommendation", () => {
    const now = new Date("2026-09-25T10:00:00Z");
    expect(nudgeNavigationAction("live_route", "accepted", {
      destination_lat: 12.97, destination_lng: 77.59,
      expires_at: "2026-09-25T10:10:00Z",
    }, now)).toEqual({ url: "https://www.google.com/maps/dir/?api=1&destination=12.97%2C77.59" });
    expect(nudgeNavigationAction("live_charger", "accepted", {
      destination_lat: 12.97, destination_lng: 77.59,
      expires_at: "2026-09-25T09:59:59Z",
    }, now)).toEqual({ error: "This live recommendation has expired. Refresh for current guidance." });
    expect(nudgeNavigationAction("live_route", "accepted", {
      destination_lat: null, destination_lng: null,
    }, now)).toEqual({ error: "This route update has no destination coordinates." });
    expect(nudgeNavigationAction("live_soc", "accepted", {}, now)).toEqual({});
  });

  it("opens navigation before recording acceptance and leaves it unrecorded on map failure", async () => {
    const calls: string[] = [];
    const payload = { destination_lat: 12.97, destination_lng: 77.59,
      expires_at: "2026-09-25T10:10:00Z" };
    await performNudgeAction("live_charger", "accepted", payload,
      async () => { calls.push("open"); },
      async () => { calls.push("record"); },
      new Date("2026-09-25T10:00:00Z"));
    expect(calls).toEqual(["open", "record"]);
    calls.length = 0;
    await expect(performNudgeAction("live_charger", "accepted", payload,
      async () => { calls.push("open"); throw new Error("no map"); },
      async () => { calls.push("record"); },
      new Date("2026-09-25T10:00:00Z"))).rejects.toThrow("no map");
    expect(calls).toEqual(["open"]);
  });
});
