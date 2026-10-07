import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import OpenStreetMap from '../../components/OpenStreetMap';
import BatteryVisualizer from '../../components/BatteryVisualizer';
import { chargerLocationLabel, resolveChargerLocation } from '../locationFreshness';
import { freshnessPresentation } from '../presentation';
import { progressBarMotionStyle } from '../mapMotionSafety';

jest.mock('react-native', () => ({
  Animated: {
    Value: class {
      constructor(_value: number) {}
    },
    View: 'AnimatedView',
    loop: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    sequence: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    timing: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  },
  Easing: { ease: jest.fn(), inOut: jest.fn((value: unknown) => value) },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('live map motion safety', () => {
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    const original = console.error;
    consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      original(...args);
    });
  });

  afterAll(() => consoleError.mockRestore());

  it('keeps the WebView on a static layout boundary', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(OpenStreetMap, {
        initialLatitude: 21.17,
        initialLongitude: 72.83,
        markers: [],
        polylines: [],
      }));
    });
    const webView = renderer.root.findByType('WebView' as never);
    expect(webView.props.testID).toBe('static-map-webview');
    expect(webView.props.style).not.toHaveProperty('transform');
    expect(webView.props.style).not.toHaveProperty('opacity');
    act(() => renderer.unmount());
  });

  it('uses fresh idle lookup, then honestly labels an old fallback', () => {
    const nowMs = Date.parse('2026-10-07T08:00:00Z');
    const fresh = resolveChargerLocation({
      activeTrip: false,
      oneShot: { lat: 21.17, lng: 72.83, capturedAtMs: nowMs - 10_000 },
      lastTelemetry: null,
      nowMs,
    });
    expect(fresh).toMatchObject({ kind: 'fresh', source: 'one_shot' });

    const stale = resolveChargerLocation({
      activeTrip: false,
      oneShot: null,
      lastTelemetry: { lat: 21.16, lng: 72.82, capturedAtMs: nowMs - 600_000 },
      nowMs,
    });
    expect(stale).toMatchObject({ kind: 'last_known', source: 'telemetry_fallback' });
    expect(chargerLocationLabel(stale)).toContain('Last known phone location');
  });

  it('prefers active-trip telemetry and never fabricates missing coordinates', () => {
    const nowMs = Date.parse('2026-10-07T08:00:00Z');
    expect(resolveChargerLocation({
      activeTrip: true,
      oneShot: { lat: 1, lng: 2, capturedAtMs: nowMs - 1000 },
      lastTelemetry: { lat: 21.18, lng: 72.84, capturedAtMs: nowMs - 2000 },
      nowMs,
    })).toMatchObject({ source: 'active_trip', lat: 21.18, lng: 72.84 });
    expect(resolveChargerLocation({
      activeTrip: false,
      oneShot: null,
      lastTelemetry: null,
      nowMs,
    })).toEqual({ kind: 'unavailable', reason: 'No timestamped phone location is available.' });
  });

  it('keeps stale, offline, and waiting states readable', () => {
    const nowMs = Date.parse('2026-10-07T08:00:00Z');
    expect(freshnessPresentation(null, nowMs)).toEqual({
      state: 'waiting',
      label: 'Waiting for the first GPS update',
    });
    expect(freshnessPresentation('2026-10-07T07:58:00Z', nowMs)).toEqual({
      state: 'offline',
      label: 'Offline - last update 2m ago',
    });
  });

  it('animates progress with a transform instead of layout width', () => {
    expect(progressBarMotionStyle('animated-progress')).toEqual({
      width: '100%',
      transform: [{ scaleX: 'animated-progress' }],
    });
  });

  it('renders battery state without an always-running decorative loop', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(BatteryVisualizer, { soc: 62 }));
    });
    expect(renderer.root.findByProps({ testID: 'static-battery-visualizer' })).toBeTruthy();
    expect(renderer.root.findAllByType('AnimatedView' as never)).toHaveLength(0);
    act(() => renderer.unmount());
  });
});
