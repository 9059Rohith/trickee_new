export const INTRO_SEEN_KEY = '@trickee/intro-seen-version';
export const INTRO_RELEASE_VERSION = '1.0.24';

export type IntroMode = 'full' | 'reduced' | 'hidden';

export type IntroSelection = Readonly<{
  seenVersion: string | null;
  currentVersion: string;
  reducedMotion: boolean;
}>;

export function selectIntroMode({
  seenVersion,
  currentVersion,
  reducedMotion,
}: IntroSelection): IntroMode {
  if (seenVersion === currentVersion) {
    return 'hidden';
  }
  return reducedMotion ? 'reduced' : 'full';
}
