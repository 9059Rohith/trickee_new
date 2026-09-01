import { api } from "./api";


export type TripFinalizationStatus = {
  finalization_state: string;
  summary: {
    calculation_status?: string;
    failure_reason?: string;
    distance_km?: number | null;
    gps_window_count?: number;
    energy?: Record<string, unknown> | null;
    energy_label?: {
      actual_energy_consumed_wh?: number | null;
      actual_wh_per_km?: number | null;
      label_source?: string;
      label_confidence?: number;
      is_training_eligible?: boolean;
      eligibility_reason?: string;
    } | null;
    soc?: {
      measured_delta_pct?: number | null;
      estimated_consumed_pct?: number | null;
    };
    range?: { estimated_remaining_km?: number | null };
  } | null;
};

export type TripOverlayResult = {
  calculation_status?: string;
  prediction: Record<string, unknown> & {
    wh_per_km?: number;
    route_energy_wh?: number;
    soc_consumed_pct?: number | null;
    range_km?: number | null;
  };
  calculation: {
    distance_km?: number | null;
    gps_sample_count?: number;
    measured_wh_per_km?: number | null;
    measured_energy_wh?: number | null;
    measured_soc_used_pct?: number | null;
    measured_source?: string;
    measured_confidence?: number;
    is_training_eligible?: boolean;
    eligibility_reason?: string;
  };
};

export type FinalizedTripResult =
  | { state: "completed"; overlayResult: TripOverlayResult }
  | { state: "processing"; message: "Trip saved; processing continues" };

type PollOptions = {
  fetchStatus?: (token: string, tripId: string) => Promise<TripFinalizationStatus>;
  intervalMs?: number;
  timeoutMs?: number;
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function mapCompletedSummary(
  summary: NonNullable<TripFinalizationStatus["summary"]>
): TripOverlayResult {
  const energy = summary.energy || {};
  const label = summary.energy_label || {};
  return {
    calculation_status: summary.calculation_status,
    prediction: {
      ...energy,
      soc_consumed_pct: summary.soc?.estimated_consumed_pct,
      range_km: summary.range?.estimated_remaining_km,
    },
    calculation: {
      distance_km: summary.distance_km,
      gps_sample_count: summary.gps_window_count,
      measured_wh_per_km: label.actual_wh_per_km,
      measured_energy_wh: label.actual_energy_consumed_wh,
      measured_soc_used_pct: summary.soc?.measured_delta_pct,
      measured_source: label.label_source,
      measured_confidence: label.label_confidence,
      is_training_eligible: label.is_training_eligible,
      eligibility_reason: label.eligibility_reason,
    },
  };
}

export async function waitForTripFinalization(
  token: string,
  tripId: string,
  options: PollOptions = {}
): Promise<FinalizedTripResult> {
  const fetchStatus = options.fetchStatus || api.getTelemetryTripStatus;
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30000;
  const startedAt = Date.now();

  while (true) {
    const status = await fetchStatus(token, tripId);
    if (status.finalization_state === "completed" && status.summary) {
      return { state: "completed", overlayResult: mapCompletedSummary(status.summary) };
    }
    if (["failed", "permanent_failure", "permanently_failed"].includes(status.finalization_state)) {
      throw new Error(status.summary?.failure_reason || "Trip finalization failed");
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      return { state: "processing", message: "Trip saved; processing continues" };
    }
    await delay(Math.min(intervalMs, remainingMs));
  }
}
