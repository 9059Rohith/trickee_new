import { shouldRefreshRoute, type RouteRefreshSnapshot } from "../routeRefreshPolicy";

const snapshot = (overrides: Partial<RouteRefreshSnapshot> = {}): RouteRefreshSnapshot => ({
  latitude: 21.1702,
  longitude: 72.8311,
  soc: 70,
  destinationKey: "23.1,72.5",
  requestedAtMs: 1_000_000,
  ...overrides,
});

describe("route intelligence refresh policy", () => {
  it("does not turn one-second GPS capture into one-second provider requests", () => {
    const previous = snapshot();
    expect(shouldRefreshRoute(previous, snapshot({ latitude: 21.17021, requestedAtMs: 1_001_000 }), 1_001_000)).toBe(false);
  });

  it("refreshes after meaningful movement, SOC change, destination change or max age", () => {
    const previous = snapshot();
    expect(shouldRefreshRoute(previous, snapshot({ latitude: 21.172 }), 1_005_000)).toBe(true);
    expect(shouldRefreshRoute(previous, snapshot({ soc: 67 }), 1_005_000)).toBe(true);
    expect(shouldRefreshRoute(previous, snapshot({ destinationKey: "23.2,72.6" }), 1_005_000)).toBe(true);
    expect(shouldRefreshRoute(previous, snapshot(), 1_031_000)).toBe(true);
  });

  it("always permits the first request", () => {
    expect(shouldRefreshRoute(null, snapshot(), 1_000_000)).toBe(true);
  });
});
