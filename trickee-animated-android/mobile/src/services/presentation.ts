export type FreshnessPresentation = {
  state: "live" | "delayed" | "offline" | "waiting";
  label: string;
};

const ageLabel = (ageSeconds: number) => {
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  return `${Math.floor(ageSeconds / 3600)}h`;
};

export function freshnessPresentation(eventTime?: string | null, nowMs = Date.now()): FreshnessPresentation {
  if (!eventTime) return { state: "waiting", label: "Waiting for the first GPS update" };
  const parsed = Date.parse(eventTime);
  if (!Number.isFinite(parsed)) return { state: "waiting", label: "Waiting for a valid GPS update" };
  const ageSeconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (ageSeconds <= 15) return { state: "live", label: `Live - updated ${ageLabel(ageSeconds)} ago` };
  if (ageSeconds <= 60) return { state: "delayed", label: `Delayed - updated ${ageLabel(ageSeconds)} ago` };
  return { state: "offline", label: `Offline - last update ${ageLabel(ageSeconds)} ago` };
}

export function metricText(value: number | null | undefined, digits = 1, unit = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

export const nudgeAcceptanceLabel = (activatesRoute: boolean) =>
  activatesRoute ? "Use this route" : "Mark accepted";
