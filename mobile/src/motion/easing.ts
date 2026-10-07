export type WebEasingName =
  | 'power2.inOut'
  | 'power2.out'
  | 'power3.out'
  | 'sine.out'
  | 'back.out(1.5)';

export type EasingFunction = (value: number) => number;

export function power2InOut(value: number): number {
  'worklet';
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function power2Out(value: number): number {
  'worklet';
  return 1 - Math.pow(1 - value, 3);
}

export function power3Out(value: number): number {
  'worklet';
  return 1 - Math.pow(1 - value, 4);
}

export function sineOut(value: number): number {
  'worklet';
  return Math.sin((value * Math.PI) / 2);
}

export function backOut(value: number, overshoot = 1.5): number {
  'worklet';
  const shifted = value - 1;
  return 1 +
    (overshoot + 1) * shifted * shifted * shifted +
    overshoot * shifted * shifted;
}

const webEasings: Record<WebEasingName, EasingFunction> = {
  'power2.inOut': power2InOut,
  'power2.out': power2Out,
  'power3.out': power3Out,
  'sine.out': sineOut,
  'back.out(1.5)': value => backOut(value, 1.5),
};

export function webEase(name: string): EasingFunction {
  const easing = webEasings[name as WebEasingName];
  if (!easing) {
    throw new Error(`Unsupported web easing: ${name}`);
  }
  return easing;
}
