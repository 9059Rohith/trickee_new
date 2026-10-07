export const ANIMATED_ROUTE_NAMES = [
  'Login',
  'VehicleOnboarding',
  'AIAssistant',
  'RouteIntel',
  'RouteNudges',
  'DailyImpact',
  'PastTrips',
  'TripDetails',
  'More',
  'Settings',
  'OwnerDashboard',
] as const;

export type AnimatedRouteName = typeof ANIMATED_ROUTE_NAMES[number];

type RoutePresentation = {
  eyebrow: string;
  title: string;
  accessibilityLabel: string;
  primaryAction?: string;
  states: {
    loading: string;
    populated: string;
    empty: string;
    offline: string;
    error: string;
  };
};

const commonStates = {
  loading: 'Loading verified vehicle data',
  populated: 'Latest verified vehicle data',
  empty: 'No verified data is available yet',
  offline: 'Offline — saved data remains available',
  error: 'Could not load data — retry again',
};

const routeCopy: Record<AnimatedRouteName, Omit<RoutePresentation, 'accessibilityLabel'>> = {
  Login: { eyebrow: 'SECURE DRIVER ACCESS', title: 'Continue your journey', states: commonStates },
  VehicleOnboarding: { eyebrow: 'VEHICLE PROFILE', title: 'Connect your EV', states: commonStates },
  AIAssistant: { eyebrow: 'VERIFIED INTELLIGENCE', title: 'Ask about your drive', states: commonStates },
  RouteIntel: { eyebrow: 'ROUTE INTELLIGENCE', title: 'Know the road ahead', states: commonStates },
  RouteNudges: { eyebrow: 'DRIVER GUIDANCE', title: 'Timely route nudges', states: commonStates },
  DailyImpact: { eyebrow: 'DAILY IMPACT', title: 'Your driving footprint', states: commonStates },
  PastTrips: { eyebrow: 'TRIP HISTORY', title: 'Review every journey', states: commonStates },
  TripDetails: {
    eyebrow: 'TRIP EVIDENCE',
    title: 'Journey breakdown',
    primaryAction: 'Retry trip details',
    states: commonStates,
  },
  More: { eyebrow: 'DRIVER TOOLKIT', title: 'Everything in one place', states: commonStates },
  Settings: { eyebrow: 'APP CONTROLS', title: 'Shape your experience', states: commonStates },
  OwnerDashboard: { eyebrow: 'FLEET OVERVIEW', title: 'Operations at a glance', states: commonStates },
};

export function routePresentationFor(route: AnimatedRouteName): RoutePresentation {
  const presentation = routeCopy[route];
  return {
    ...presentation,
    accessibilityLabel: `${presentation.eyebrow}. ${presentation.title}`,
  };
}
