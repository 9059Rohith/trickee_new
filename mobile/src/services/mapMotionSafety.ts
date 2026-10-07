export type ProgressBarMotionStyle<T> = Readonly<{
  width: '100%';
  transform: ReadonlyArray<Readonly<{ scaleX: T }>>;
}>;

/** Keeps progress feedback on the compositor instead of triggering layout each frame. */
export function progressBarMotionStyle<T>(progress: T): ProgressBarMotionStyle<T> {
  return { width: '100%', transform: [{ scaleX: progress }] };
}
