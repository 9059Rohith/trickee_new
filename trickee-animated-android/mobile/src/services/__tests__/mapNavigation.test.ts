import {
  buildDirectionsUrl,
  nudgeActionState,
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
});
