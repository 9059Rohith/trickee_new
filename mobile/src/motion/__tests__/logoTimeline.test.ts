import { logoTimeline, logoProgress } from '../logoTimeline';
import { motionColors, motionDuration } from '../tokens';
import { fontFamily } from '../../theme/typography';

describe('animated brand timing contract', () => {
  it('keeps the full intro bounded and the reduced intro below 500 ms', () => {
    expect(logoTimeline.fullDurationMs).toBe(5050);
    expect(logoTimeline.reducedDurationMs).toBe(450);
    expect(motionDuration.introFull).toBe(5050);
    expect(motionDuration.introReduced).toBe(450);
  });

  it('clamps logo progress before and after the active range', () => {
    expect(logoProgress(-1, 100, 300)).toBe(0);
    expect(logoProgress(100, 100, 300)).toBe(0);
    expect(logoProgress(250, 100, 300)).toBeCloseTo(0.5);
    expect(logoProgress(400, 100, 300)).toBe(1);
    expect(logoProgress(401, 100, 300)).toBe(1);
  });

  it('exports readable brand colors and safe font fallbacks', () => {
    expect(motionColors.yellow).toBe('#FFE000');
    expect(motionColors.cyan).toBe('#48DFF4');
    expect(fontFamily.body).toBe('Manrope-W400');
    expect(fontFamily.heading).toBe('Syne-W600');
    expect(fontFamily.technical).toBe('Michroma-Regular');
    expect(fontFamily.systemBody).toBe('sans-serif');
    expect(fontFamily.systemHeading).toBe('sans-serif-medium');
  });
});
