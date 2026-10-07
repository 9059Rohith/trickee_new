import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AnimatedScreen from '../AnimatedScreen';

let mockAppStateListener: ((state: string) => void) | null = null;

jest.mock('react-native', () => ({
  Animated: {
    Value: class {
      value: number;
      constructor(value: number) { this.value = value; }
      setValue(value: number) { this.value = value; }
    },
    View: 'AnimatedView',
    parallel: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    timing: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  },
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      mockAppStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AnimatedScreen', () => {
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    const original = console.error;
    consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      original(...args);
    });
  });

  afterAll(() => consoleError.mockRestore());

  beforeEach(() => { mockAppStateListener = null; });

  async function renderScreen(
    focused: boolean,
    reducedMotion: boolean,
  ): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <AnimatedScreen focused={focused} reducedMotion={reducedMotion} testID="shell-screen">
          <Text>Readable route content</Text>
        </AnimatedScreen>,
      );
    });
    return renderer;
  }

  it('sets final numeric values immediately for reduced motion', async () => {
    const renderer = await renderScreen(true, true);
    const surface = renderer.root.findByType('AnimatedView' as never);

    expect(surface.props.accessibilityValue.text).toBe('reduced');
    expect(surface.props.style[1]).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
    expect(renderer.root.findByProps({ children: 'Readable route content' })).toBeTruthy();
    act(() => renderer.unmount());
  });

  it('stays paused while its route is unfocused', async () => {
    const renderer = await renderScreen(false, false);
    expect(renderer.root.findByType('AnimatedView' as never).props.accessibilityValue.text)
      .toBe('paused');
    act(() => renderer.unmount());
  });

  it('moves to paused when the application backgrounds', async () => {
    const renderer = await renderScreen(true, false);
    expect(renderer.root.findByType('AnimatedView' as never).props.accessibilityValue.text)
      .toBe('full');

    act(() => mockAppStateListener?.('background'));
    expect(renderer.root.findByType('AnimatedView' as never).props.accessibilityValue.text)
      .toBe('paused');
    act(() => renderer.unmount());
  });
});
