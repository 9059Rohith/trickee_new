import {
  DEFAULT_BOTTOM_NAVIGATION_CLEARANCE,
  resolveBottomNavigationClearance,
} from "../homeLayout";

describe("home trip action layout", () => {
  it("uses the measured bottom navigation height to keep the action clickable", () => {
    expect(resolveBottomNavigationClearance(108)).toBe(108);
  });

  it("keeps a safe initial clearance until the bottom navigation is measured", () => {
    expect(resolveBottomNavigationClearance(0)).toBe(
      DEFAULT_BOTTOM_NAVIGATION_CLEARANCE
    );
    expect(resolveBottomNavigationClearance(Number.NaN)).toBe(
      DEFAULT_BOTTOM_NAVIGATION_CLEARANCE
    );
  });
});
