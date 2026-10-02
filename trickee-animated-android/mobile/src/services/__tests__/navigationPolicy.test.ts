import { canEditAdvancedVehicleSpecs, navigationForRole } from "../navigationPolicy";

describe("authenticated navigation policy", () => {
  it.each(["owner", "fleet_admin", "admin"])("keeps %s inside a navigable owner shell", role => {
    expect(navigationForRole(role)).toEqual({
      home: "owner",
      tabs: ["Home", "Live Map", "Monitoring", "More"],
    });
  });

  it("keeps drivers on the existing driver home and tab routes", () => {
    expect(navigationForRole("driver")).toEqual({
      home: "driver",
      tabs: ["Home", "Live Map", "Monitoring", "More"],
    });
  });

  it("fails closed to the driver shell for an unknown legacy role", () => {
    expect(navigationForRole("legacy").home).toBe("driver");
  });

  it.each(["owner", "fleet_admin", "admin"])("allows %s to edit verified vehicle specifications", role => {
    expect(canEditAdvancedVehicleSpecs(role)).toBe(true);
  });

  it.each(["driver", "legacy", undefined])("keeps advanced vehicle specifications read-only for %s", role => {
    expect(canEditAdvancedVehicleSpecs(role)).toBe(false);
  });
});
