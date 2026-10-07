export type MotionMode = 'full' | 'reduced' | 'paused';

export type MotionStateInput = Readonly<{
  reducedMotion: boolean;
  appActive: boolean;
  focused: boolean;
}>;

export function motionState({
  reducedMotion,
  appActive,
  focused,
}: MotionStateInput): MotionMode {
  if (!appActive || !focused) {
    return 'paused';
  }
  return reducedMotion ? 'reduced' : 'full';
}
