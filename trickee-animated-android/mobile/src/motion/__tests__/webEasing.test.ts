import { backOut, power2InOut, power2Out, power3Out, sineOut } from "../easing";
import samples from "./webEasingSamples.json";

const easings = {
  "power2.inOut": power2InOut,
  "power2.out": power2Out,
  "power3.out": power3Out,
  "sine.out": sineOut,
  "back.out(1.5)": (value: number) => backOut(value, 1.5),
} as const;

describe("logo easing parity with GSAP source", () => {
  for (const [name, easing] of Object.entries(easings)) {
    it(`${name} matches 21 GSAP samples within 0.005`, () => {
      for (const [index, expected] of samples[name as keyof typeof samples].entries()) {
        expect(Math.abs(easing(index / 20) - expected)).toBeLessThanOrEqual(0.005);
      }
    });
  }
});
