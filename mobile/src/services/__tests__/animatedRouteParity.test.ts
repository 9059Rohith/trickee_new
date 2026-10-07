import {
  ANIMATED_ROUTE_NAMES,
  routePresentationFor,
} from '../animatedRoutePresentation';
import { navigationForRole } from '../navigationPolicy';

describe('animated route presentation parity', () => {
  it('covers every remaining production route', () => {
    expect(ANIMATED_ROUTE_NAMES).toEqual([
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
    ]);
  });

  it.each(ANIMATED_ROUTE_NAMES)('%s has useful visible and accessible copy', route => {
    const presentation = routePresentationFor(route);
    expect(presentation.eyebrow.length).toBeGreaterThan(2);
    expect(presentation.title.length).toBeGreaterThan(4);
    expect(presentation.accessibilityLabel).toContain(presentation.title);
  });

  it('defines honest state and recovery language', () => {
    const copy = routePresentationFor('TripDetails').states;
    expect(copy.loading).toMatch(/loading/i);
    expect(copy.empty).toMatch(/not.*available|no /i);
    expect(copy.offline).toMatch(/offline|connection/i);
    expect(copy.error).toMatch(/retry|again/i);
    expect(routePresentationFor('TripDetails').primaryAction).toBe('Retry trip details');
  });

  it('does not change owner or driver navigation', () => {
    expect(navigationForRole('driver')).toEqual({
      home: 'driver',
      tabs: ['Home', 'Live Map', 'Monitoring', 'More'],
    });
    expect(navigationForRole('owner')).toEqual({
      home: 'owner',
      tabs: ['Home', 'Live Map', 'Monitoring', 'More'],
    });
  });
});
