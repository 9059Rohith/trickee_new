import { motionDurations } from "./tokens";

export type LogoStage = "grid" | "orbits" | "pulse" | "halo" | "route" | "ripples" | "art" | "shine" | "caption" | "exit";

export const logoStages: Record<LogoStage, { start: number; duration: number }> = {
  grid: { start: 0, duration: 1400 },
  orbits: { start: 100, duration: 1800 },
  pulse: { start: 150, duration: 600 },
  halo: { start: 200, duration: 2400 },
  route: { start: 350, duration: 1600 },
  ripples: { start: 650, duration: 1700 },
  art: { start: 1250, duration: 1350 },
  shine: { start: 2050, duration: 1650 },
  caption: { start: 2400, duration: 800 },
  exit: { start: 4400, duration: 650 },
};

export const logoRoutePaths = [
  "M160 183C131 116 161 38 249 36C336 37 367 116 337 184L249 334L160 195H250V333",
  "M206 121H297M251 76V166M251 121L280 88M251 121L280 154M201 257H250",
] as const;

export const logoRouteCircle = { cx: 251, cy: 121, r: 46 } as const;

/** Chromium SVGGeometryElement.getTotalLength() on the website's route artwork. */
export const logoRouteLengths = [982.8025512695312, 288.5596008300781, 317.863525390625] as const;

/** This pure function can also execute inside a Reanimated worklet. */
export function stageProgress(milliseconds: number, stage: LogoStage): number {
  "worklet";
  const { start, duration } = logoStages[stage];
  return Math.max(0, Math.min(1, (milliseconds - start) / duration));
}

export function logoIsResolved(milliseconds: number): boolean {
  return milliseconds >= motionDurations.introResolved;
}

export function logoIsComplete(milliseconds: number, reducedMotion = false): boolean {
  return milliseconds >= (reducedMotion ? motionDurations.reducedIntro : motionDurations.introTotal);
}
