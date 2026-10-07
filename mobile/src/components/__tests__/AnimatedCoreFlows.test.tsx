import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import DestinationPicker from '../DestinationPicker';
import NextTripCard from '../NextTripCard';
import PlanConfirmationProgress from '../PlanConfirmationProgress';
import { validateTripStart, type TripDestination } from '../../services/tripStart';

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: jest.fn() },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));

jest.mock('../VoiceInputButton', () => ({
  __esModule: true,
  default: ({ onFinalText, label }: { onFinalText?: (value: string) => void; label: string }) =>
    require('react').createElement('VoiceInput', { onFinalText, label, testID: 'core-voice-input' }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('animated core flow parity', () => {
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    const original = console.error;
    consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      original(...args);
    });
  });

  afterAll(() => consoleError.mockRestore());

  async function renderDestination(
    destination: TripDestination,
    overrides: Partial<React.ComponentProps<typeof DestinationPicker>> = {},
  ): Promise<{ renderer: ReactTestRenderer; onChange: jest.Mock; onSearch: jest.Mock; onPickMap: jest.Mock }> {
    const onChange = jest.fn();
    const onSearch = jest.fn();
    const onPickMap = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <DestinationPicker
          destination={destination}
          onChange={onChange}
          onPickMap={onPickMap}
          onSearch={onSearch}
          searching={false}
          searchError={null}
          {...overrides}
        />,
      );
    });
    return { renderer, onChange, onSearch, onPickMap };
  }

  it('keeps planned-stop provenance inside the animated surface', async () => {
    const { renderer } = await renderDestination({
      mode: 'planned',
      source: 'planned_stop',
      planId: 'plan-1',
      legIndex: 0,
      text: 'Surat Station',
      lat: 21.2,
      lng: 72.8,
    });
    expect(renderer.root.findByProps({ testID: 'animated-destination-picker' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: 'PLANNED STOP' })).toBeTruthy();
    act(() => renderer.unmount());
  });

  it('keeps manual search, voice, map-pin, and provider-error controls wired', async () => {
    const { renderer, onSearch, onPickMap } = await renderDestination({
      mode: 'manual',
      source: 'search_result',
      text: 'Ahmedabad Airport',
      lat: 23.0772,
      lng: 72.6347,
    }, { searchError: 'Destination provider unavailable. Try again.' });

    act(() => renderer.root.findByProps({ testID: 'trip-destination-search' }).props.onPress());
    expect(onSearch).toHaveBeenCalledWith('Ahmedabad Airport');
    act(() => renderer.root.findByProps({ testID: 'core-voice-input' }).props.onFinalText('Ahmedabad Airport'));
    expect(onSearch).toHaveBeenCalledTimes(2);
    act(() => renderer.root.findByProps({ testID: 'trip-destination-map' }).props.onPress());
    expect(onPickMap).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ children: 'Destination provider unavailable. Try again.' })).toBeTruthy();
    expect(renderer.root.findAllByType('Text' as never).map(node => node.children.join(' ')).join(' '))
      .toContain('SEARCH PIN');
    act(() => renderer.unmount());
  });

  it('keeps explicit destinationless warning and invalid SOC gating', async () => {
    const { renderer } = await renderDestination({
      mode: 'destinationless',
      source: 'destinationless',
      warningAcknowledged: true,
    });
    expect(renderer.root.findByProps({ children: 'DESTINATIONLESS RECORDING' })).toBeTruthy();

    const validation = validateTripStart({
      tripId: 'trip-1',
      vehicleId: 'vehicle-1',
      startingSoc: 101,
      idempotencyKey: 'start-1',
      destination: { mode: 'destinationless', source: 'destinationless', warningAcknowledged: true },
    });
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('0 to 100');
    act(() => renderer.unmount());
  });

  it('keeps planned start callback and busy confirmation progress visible', async () => {
    const onStart = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<>
        <NextTripCard leg={{
          plan_id: 'plan-1',
          leg_index: 0,
          destination_text: 'Office',
          destination_lat: 21.2,
          destination_lng: 72.8,
          planned_departure_at: null,
          planned_arrival_at: null,
          service_date: '2026-10-07',
          timezone: 'Asia/Kolkata',
          status: 'planned',
        }} onStart={onStart} />
        <PlanConfirmationProgress stage="route_soc" />
      </>);
    });
    expect(renderer.root.findByProps({ testID: 'animated-next-trip-card' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'animated-plan-confirmation' })).toBeTruthy();
    act(() => renderer.root.findByProps({ testID: 'next-trip-start' }).props.onPress());
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
