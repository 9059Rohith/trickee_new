import { motionDuration } from './tokens';

export type LogoStage =
  | 'grid'
  | 'orbits'
  | 'pulse'
  | 'halo'
  | 'route'
  | 'ripples'
  | 'art'
  | 'shine'
  | 'caption'
  | 'exit';

export type LogoStageTiming = Readonly<{ startMs: number; durationMs: number }>;

export const logoTimeline = {
  fullDurationMs: motionDuration.introFull,
  reducedDurationMs: motionDuration.introReduced,
  stages: {
    grid: { startMs: 0, durationMs: 1400 },
    orbits: { startMs: 100, durationMs: 1800 },
    pulse: { startMs: 150, durationMs: 600 },
    halo: { startMs: 200, durationMs: 2400 },
    route: { startMs: 350, durationMs: 1600 },
    ripples: { startMs: 650, durationMs: 1700 },
    art: { startMs: 1250, durationMs: 1350 },
    shine: { startMs: 2050, durationMs: 1650 },
    caption: { startMs: 2400, durationMs: 800 },
    exit: { startMs: 4400, durationMs: 650 },
  } satisfies Record<LogoStage, LogoStageTiming>,
} as const;

export function logoProgress(
  milliseconds: number,
  startMs: number,
  durationMs: number,
): number {
  'worklet';
  return Math.max(0, Math.min(1, (milliseconds - startMs) / durationMs));
}

export function stageProgress(milliseconds: number, stage: LogoStage): number {
  'worklet';
  const timing = logoTimeline.stages[stage];
  return logoProgress(milliseconds, timing.startMs, timing.durationMs);
}

export function logoIsResolved(milliseconds: number): boolean {
  return milliseconds >= motionDuration.introResolved;
}

export function logoIsComplete(milliseconds: number, reducedMotion = false): boolean {
  return milliseconds >= (reducedMotion
    ? logoTimeline.reducedDurationMs
    : logoTimeline.fullDurationMs);
}

export const logoRoutePaths = [
  'M160 183C131 116 161 38 249 36C336 37 367 116 337 184L249 334L160 195H250V333',
  'M206 121H297M251 76V166M251 121L280 88M251 121L280 154M201 257H250',
] as const;

export const logoRouteCircle = { cx: 251, cy: 121, r: 46 } as const;
export const logoRouteLengths = [982.8025512695312, 288.5596008300781, 317.863525390625] as const;
