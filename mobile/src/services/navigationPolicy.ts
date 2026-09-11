export type AuthenticatedHome = "driver" | "owner";

const OWNER_ROLES = new Set(["owner", "fleet_admin", "admin"]);
const AUTHENTICATED_TABS = ["Home", "Live Map", "Monitoring", "More"] as const;

export function navigationForRole(role?: string | null): {
  home: AuthenticatedHome;
  tabs: string[];
} {
  return {
    home: role && OWNER_ROLES.has(role) ? "owner" : "driver",
    tabs: [...AUTHENTICATED_TABS],
  };
}

export function canEditAdvancedVehicleSpecs(role?: string | null): boolean {
  return !!role && OWNER_ROLES.has(role);
}
