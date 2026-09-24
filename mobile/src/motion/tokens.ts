/** Values measured from the public journey's source, not restyled app defaults. */
export const motionColors = {
  ink: "#020609",
  panel: "#071118",
  text: "#F5F8F7",
  cyan: "#48DFF4",
  yellow: "#FFE000",
  amber: "#FF9E4F",
  coral: "#FF7066",
} as const;

export const motionDurations = {
  instant: 120,
  fast: 260,
  base: 420,
  slow: 900,
  heroText: 1350,
  introResolved: 2600,
  introHold: 4400,
  introExit: 650,
  introTotal: 5050,
  reducedIntro: 650,
} as const;

export const motionEasings = {
  softOut: [0.16, 1, 0.3, 1],
  routeInOut: [0.2, 0.8, 0.2, 1],
  progressInOut: [0.25, 0.1, 0.25, 1],
} as const;

export const motionGeometry = {
  revealDistance: 42,
  heroTextRisePercent: 65,
  heroCharacterStagger: 26,
  logoViewBox: 500,
  logoStrokeWidth: 1.7,
  logoOrbitScaleStart: 0.45,
  logoImageScaleStart: 0.94,
} as const;
