export const MAIN_TAB_NAMES = ['Home', 'Live Map', 'Monitoring', 'More'] as const;

export const DETAIL_ROUTE_NAMES = [
  'AIAssistant',
  'RouteIntel',
  'PastTrips',
  'TripDetails',
  'DailyImpact',
  'RouteNudges',
  'DailyPlanner',
  'TripStart',
  'VehicleOnboarding',
] as const;

const TAB_PRESENTATION: Record<string, { icon: string; label: string }> = {
  Home: { icon: 'home-variant-outline', label: 'Home' },
  'Live Map': { icon: 'map-marker-radius-outline', label: 'Live Map' },
  Monitoring: { icon: 'chart-timeline-variant-shimmer', label: 'Monitoring' },
  More: { icon: 'dots-grid', label: 'More' },
};

export function tabPresentationFor(routeName: string): { icon: string; label: string } {
  return TAB_PRESENTATION[routeName] ?? { icon: 'circle-outline', label: routeName };
}

type TabNavigation = Readonly<{
  emit: (event: {
    type: 'tabPress';
    target: string;
    canPreventDefault: true;
  }) => { defaultPrevented?: boolean };
  navigate: (name: string) => void;
}>;

type TabRoute = Readonly<{ key: string; name: string }>;

export function runTabPress(
  navigation: TabNavigation,
  route: TabRoute,
  isFocused: boolean,
): void {
  const event = navigation.emit({
    type: 'tabPress',
    target: route.key,
    canPreventDefault: true,
  });
  if (!isFocused && !event.defaultPrevented) {
    navigation.navigate(route.name);
  }
}
