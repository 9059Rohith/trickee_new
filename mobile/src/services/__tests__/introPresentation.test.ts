import {
  INTRO_RELEASE_VERSION,
  INTRO_SEEN_KEY,
  selectIntroMode,
} from '../introPresentation';

describe('selectIntroMode', () => {
  it('shows the full intro on first launch', () => {
    expect(selectIntroMode({
      seenVersion: null,
      currentVersion: '1.0.24',
      reducedMotion: false,
    })).toBe('full');
  });

  it('hides the intro after this version completed', () => {
    expect(selectIntroMode({
      seenVersion: '1.0.24',
      currentVersion: '1.0.24',
      reducedMotion: false,
    })).toBe('hidden');
  });

  it('replays once after an application upgrade', () => {
    expect(selectIntroMode({
      seenVersion: '1.0.23',
      currentVersion: '1.0.24',
      reducedMotion: false,
    })).toBe('full');
  });

  it('uses the reduced presentation for a new version when requested', () => {
    expect(selectIntroMode({
      seenVersion: '1.0.23',
      currentVersion: '1.0.24',
      reducedMotion: true,
    })).toBe('reduced');
  });

  it('publishes a version-specific storage contract', () => {
    expect(INTRO_SEEN_KEY).toBe('@trickee/intro-seen-version');
    expect(INTRO_RELEASE_VERSION).toBe('1.0.24');
  });
});
