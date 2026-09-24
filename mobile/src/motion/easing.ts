/** Exact GSAP easing families used by the public logo intro. */
export function power2InOut(value: number): number {
  "worklet";
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function power2Out(value: number): number {
  "worklet";
  return 1 - Math.pow(1 - value, 3);
}

export function power3Out(value: number): number {
  "worklet";
  return 1 - Math.pow(1 - value, 4);
}

export function sineOut(value: number): number {
  "worklet";
  return Math.sin(value * Math.PI / 2);
}

export function backOut(value: number, overshoot = 1.5): number {
  "worklet";
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}
