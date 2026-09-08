import { estimateLiveSoc } from "../liveSoc";

describe("active-trip SOC estimate", () => {
  it("reduces starting SOC from live GPS distance and the latest energy rate", () => {
    expect(
      estimateLiveSoc({
        startingSocPct: 80,
        distanceKm: 10,
        usableKwh: 3,
        whPerKm: 44,
      })
    ).toBeCloseTo(65.33, 2);
  });

  it("returns null rather than inventing SOC when an input is unavailable", () => {
    expect(
      estimateLiveSoc({
        startingSocPct: null,
        distanceKm: 10,
        usableKwh: 3,
        whPerKm: 44,
      })
    ).toBeNull();
  });
});
