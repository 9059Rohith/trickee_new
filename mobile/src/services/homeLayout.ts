export const DEFAULT_BOTTOM_NAVIGATION_CLEARANCE = 96;

export const resolveBottomNavigationClearance = (measuredHeight: number) =>
  Number.isFinite(measuredHeight) && measuredHeight > 0
    ? measuredHeight
    : DEFAULT_BOTTOM_NAVIGATION_CLEARANCE;
