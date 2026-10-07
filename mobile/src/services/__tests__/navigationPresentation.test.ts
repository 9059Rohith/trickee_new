import {
  DETAIL_ROUTE_NAMES,
  MAIN_TAB_NAMES,
  runTabPress,
  tabPresentationFor,
} from '../navigationPresentation';
import { fontFamily } from '../../theme/typography';

describe('navigation presentation contract', () => {
  it('retains every production tab and detail route', () => {
    expect(MAIN_TAB_NAMES).toEqual(['Home', 'Live Map', 'Monitoring', 'More']);
    expect(DETAIL_ROUTE_NAMES).toEqual([
      'AIAssistant',
      'RouteIntel',
      'PastTrips',
      'TripDetails',
      'DailyImpact',
      'RouteNudges',
      'DailyPlanner',
      'TripStart',
      'VehicleOnboarding',
    ]);
  });

  it('navigates synchronously when tab press is allowed', () => {
    const calls: string[] = [];
    const navigation = {
      emit: () => ({ defaultPrevented: false }),
      navigate: (name: string) => { calls.push(name); },
    };

    runTabPress(navigation, { key: 'live-map-key', name: 'Live Map' }, false);
    expect(calls).toEqual(['Live Map']);
  });

  it('does not navigate a focused or prevented tab', () => {
    const navigate = jest.fn();
    runTabPress({ emit: () => ({ defaultPrevented: false }), navigate }, { key: 'home', name: 'Home' }, true);
    runTabPress({ emit: () => ({ defaultPrevented: true }), navigate }, { key: 'map', name: 'Live Map' }, false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps unknown route labels readable with a safe font fallback', () => {
    expect(tabPresentationFor('Diagnostics')).toEqual({ icon: 'circle-outline', label: 'Diagnostics' });
    expect(fontFamily.systemBody).toBe('sans-serif');
  });
});
