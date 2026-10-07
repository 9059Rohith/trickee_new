/** Bundled brand families plus explicit Android system fallbacks. */
export const fontFamily = {
  body: 'Manrope-W400',
  bodyMedium: 'Manrope-W500',
  bodySemibold: 'Manrope-W600',
  bodyBold: 'Manrope-W700',
  bodyHeavy: 'Manrope-W800',
  heading: 'Syne-W600',
  headingBold: 'Syne-W700',
  technical: 'Michroma-Regular',
  systemBody: 'sans-serif',
  systemHeading: 'sans-serif-medium',
} as const;

export const typography = {
  body: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 27 },
  bodySmall: { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 19 },
  heading: { fontFamily: fontFamily.heading, fontSize: 32, lineHeight: 34, letterSpacing: -1.2 },
  hero: { fontFamily: fontFamily.headingBold, fontSize: 52, lineHeight: 47, letterSpacing: -3.4 },
  technical: { fontFamily: fontFamily.technical, fontSize: 9, lineHeight: 16, letterSpacing: 1.35 },
} as const;
