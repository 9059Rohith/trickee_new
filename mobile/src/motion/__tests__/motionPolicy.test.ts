import { motionState } from '../motionPolicy';

describe('motionState', () => {
  it('pauses when the app is inactive', () => {
    expect(motionState({ reducedMotion: false, appActive: false, focused: true })).toBe('paused');
  });

  it('pauses when the route is unfocused', () => {
    expect(motionState({ reducedMotion: false, appActive: true, focused: false })).toBe('paused');
  });

  it('uses reduced motion only while visible and active', () => {
    expect(motionState({ reducedMotion: true, appActive: true, focused: true })).toBe('reduced');
  });

  it('uses full motion for an active focused route', () => {
    expect(motionState({ reducedMotion: false, appActive: true, focused: true })).toBe('full');
  });
});
