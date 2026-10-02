export function estimateLiveSoc(options: {
  startingSocPct?: number | null;
  distanceKm?: number | null;
  usableKwh?: number | null;
  whPerKm?: number | null;
}): number | null {
  const { startingSocPct, distanceKm, usableKwh, whPerKm } = options;
  if (
    startingSocPct == null ||
    distanceKm == null ||
    usableKwh == null ||
    whPerKm == null ||
    ![startingSocPct, distanceKm, usableKwh, whPerKm].every(Number.isFinite) ||
    startingSocPct < 0 ||
    startingSocPct > 100 ||
    distanceKm < 0 ||
    usableKwh <= 0 ||
    whPerKm <= 0
  ) {
    return null;
  }
  return Math.max(
    0,
    Math.min(100, startingSocPct - (distanceKm * whPerKm * 100) / (usableKwh * 1000))
  );
}
