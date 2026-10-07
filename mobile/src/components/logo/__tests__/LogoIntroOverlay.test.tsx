import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import LogoIntroOverlay from '../LogoIntroOverlay';

let mockAppStateListener: ((state: string) => void) | null = null;
let mockLogoComplete: (() => void) | null = null;

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      mockAppStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
  Text: 'Text',
  View: 'View',
}));

jest.mock('../TrickeeLogoAnimated', () => ({
  __esModule: true,
  default: ({ onComplete, active, mode }: {
    onComplete: () => void;
    active: boolean;
    mode: string;
  }) => {
    mockLogoComplete = onComplete;
    return require('react').createElement('Logo', { active, mode, testID: 'animated-logo' });
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LogoIntroOverlay', () => {
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    const original = console.error;
    consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      original(...args);
    });
  });

  afterAll(() => consoleError.mockRestore());

  beforeEach(() => {
    jest.useFakeTimers();
    mockAppStateListener = null;
    mockLogoComplete = null;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  async function renderOverlay(onComplete = jest.fn()): Promise<{
    renderer: ReactTestRenderer;
    onComplete: jest.Mock;
  }> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <LogoIntroOverlay mode="full" onComplete={onComplete} fallbackMs={5750} />,
      );
    });
    return { renderer, onComplete };
  }

  it('keeps meaningful route, energy, and journey copy visible', async () => {
    const { renderer } = await renderOverlay();
    const copy = renderer.root
      .findAllByType('Text' as never)
      .map(node => node.children.join(' '))
      .join(' ');

    expect(copy).toContain('Route');
    expect(copy).toContain('energy');
    expect(copy).toContain('journey');
    expect(renderer.root.findByProps({ testID: 'intro-skip' })).toBeTruthy();
    act(() => renderer.unmount());
  });

  it('completes only once when Skip is pressed repeatedly', async () => {
    const { renderer, onComplete } = await renderOverlay();
    const skip = renderer.root.findByProps({ testID: 'intro-skip' });

    act(() => {
      skip.props.onPress();
      skip.props.onPress();
      jest.advanceTimersByTime(6000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('uses the fallback deadline when the animation callback is lost', async () => {
    const { renderer, onComplete } = await renderOverlay();

    act(() => jest.advanceTimersByTime(5749));
    expect(onComplete).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('pauses visual motion in the background and never completes twice', async () => {
    const { renderer, onComplete } = await renderOverlay();

    act(() => mockAppStateListener?.('background'));
    expect(renderer.root.findByProps({ testID: 'animated-logo' }).props.active).toBe(false);
    act(() => mockAppStateListener?.('active'));
    expect(renderer.root.findByProps({ testID: 'animated-logo' }).props.active).toBe(true);
    act(() => {
      mockLogoComplete?.();
      jest.advanceTimersByTime(5750);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
