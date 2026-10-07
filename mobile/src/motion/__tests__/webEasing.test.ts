import { webEase } from '../easing';

const samples: Record<string, ReadonlyArray<readonly [number, number]>> = {
  'power2.inOut': [[0, 0], [0.25, 0.0625], [0.5, 0.5], [0.75, 0.9375], [1, 1]],
  'power2.out': [[0, 0], [0.25, 0.578125], [0.5, 0.875], [0.75, 0.984375], [1, 1]],
  'power3.out': [[0, 0], [0.25, 0.68359375], [0.5, 0.9375], [0.75, 0.99609375], [1, 1]],
  'sine.out': [[0, 0], [0.25, 0.38268343], [0.5, 0.70710678], [0.75, 0.92387953], [1, 1]],
  'back.out(1.5)': [[0, 0], [0.25, 0.7890625], [0.5, 1.0625], [0.75, 1.0546875], [1, 1]],
};

describe('webEase', () => {
  for (const [name, points] of Object.entries(samples)) {
    it(`${name} matches the hand-checked GSAP samples`, () => {
      const easing = webEase(name);
      for (const [input, expected] of points) {
        expect(easing(input)).toBeCloseTo(expected, 6);
      }
    });
  }

  it('rejects an unknown easing instead of silently changing motion', () => {
    expect(() => webEase('unknown')).toThrow('Unsupported web easing: unknown');
  });
});
