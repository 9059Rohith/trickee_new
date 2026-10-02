/**
 * Trickee GPS-First Types
 *
 * NON-NEGOTIABLE (§1 rule 4-5):
 * - GPS-derived proxies use explicit names: traction_demand_proxy, regen_opportunity_proxy
 * - Never "throttle" or "regenerated_energy"
 * - Every prediction carries: value, confidence, source, estimated
 */

// --- Auth ---
export type User = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  fleet_id?: string;
  driver_id?: string;
};

export type Driver = {
  id: string;
  driver_code: string;
  full_name: string;
  style_label: string;
};

// --- Vehicle ---
export type Vehicle = {
  id: string;
  fleet_id?: string;
  vehicle_code: string;
  make: string;
  model: string;
  category?: string;
  variant?: string;
  battery_capacity_kwh: number;
  max_range_km: number;
  battery_chemistry: string;
  usable_kwh?: number;
  rated_ah?: number;
  nominal_voltage?: number;
  motor_kw?: number;
  kerb_weight?: number;
  gvw?: number;
  payload_capacity?: number;
  top_speed?: number;
  regen_available?: boolean;
  certified_range?: number;
  spec_incomplete: boolean;
  is_active: boolean;
  latest_dynamic_range_km?: number;
};

export type VehicleSpecUpdate = {
  category?: string;
  make?: string;
  model?: string;
  variant?: string;
  usable_kwh?: number;
  rated_ah?: number;
  battery_chemistry?: string;
  nominal_voltage?: number;
  motor_kw?: number;
  kerb_weight?: number;
  gvw?: number;
  payload_capacity?: number;
  top_speed?: number;
  regen_available?: boolean;
  certified_range?: number;
};

// --- Telemetry (legacy V4.1 — NOT fabricated for GPS model) ---
export type Telemetry = {
  id: string;
  soc?: number;
  speed?: number;
  recorded_at: string;
  lat?: number;
  lng?: number;
  ignition_on?: boolean;
};

// --- Alerts ---
export type Alert = {
  id: string;
  vehicle_id: string;
  driver_id?: string;
  alert_type: string;
  message: string;
  soc_at_alert?: number;
  is_resolved: boolean;
  created_at: string;
};

export type RouteNudgeEvent =
  | "delivered"
  | "opened"
  | "accepted"
  | "dismissed"
  | "followed";

export type RouteNudgePayload = {
  screen: "route_nudge" | "daily_planner";
  decision_id?: string;
  planned_trip_id?: string;
  selected_route_id?: string | null;
  selected_charger_id?: string | null;
  route_name?: string | null;
  leave_at?: string | null;
  arrival_soc_pct?: number | null;
  provider_source?: string | null;
  confidence?: number | null;
  degraded_reason?: string | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  place_confirmed?: boolean | null;
  availability_confirmed?: boolean | null;
  google_maps_uri?: string | null;
};

export type RouteNudgeOutcome = {
  latest_event: RouteNudgeEvent;
  delivered_at?: string | null;
  opened_at?: string | null;
  accepted_at?: string | null;
  dismissed_at?: string | null;
  followed_at?: string | null;
  selected_route_id?: string | null;
  selected_charger_id?: string | null;
};

export type RouteNudge = {
  id: string;
  driver_id?: string | null;
  vehicle_id?: string | null;
  planned_trip_id?: string | null;
  route_decision_id?: string | null;
  nudge_type: string;
  title: string;
  body: string;
  payload: RouteNudgePayload;
  delivery_status: string;
  attempts: number;
  due_at: string;
  sent_at?: string | null;
  failed_at?: string | null;
  provider_error_code?: string | null;
  outcome: RouteNudgeOutcome | null;
};

export type DailyPlanStop = {
  /** Local-only identity used by the planner UI. Stripped before API submission. */
  local_id?: string;
  label: string;
  requested_arrival_local: string | null;
  status: "unresolved" | "needs_confirmation" | string;
  coordinates?: { lat: number; lng: number } | null;
  resolved_location?: {
    place_id?: string | null;
    name?: string | null;
    formatted_address?: string | null;
    coordinates?: { lat: number; lng: number } | null;
    source: string;
    confidence?: number;
    degraded_reason?: string | null;
  } | null;
};

export type DailyPlanDraft = {
  service_date: string;
  timezone: string;
  stops: DailyPlanStop[];
  parser_source: string;
  warnings: string[];
};

export type DailyPlanLeg = {
  index: number;
  destination: {
    query?: string;
    name?: string | null;
    coordinates?: { lat: number; lng: number } | null;
    source?: string;
  };
  requested_arrival_local: string | null;
  planned_departure_at: string | null;
  estimated_arrival_at: string | null;
  distance_m: number | null;
  duration_s: number | null;
  traffic_delay_s: number | null;
  starting_soc_pct: number | null;
  energy_wh: number | null;
  arrival_soc_pct: number | null;
  route_source: string;
  energy_source: string;
  confidence: number;
  degraded_reason: string | null;
  chargers: Array<Record<string, unknown>>;
};

export type DailyPlan = {
  id: string;
  driver_id: string;
  vehicle_id: string;
  service_date: string;
  timezone: string;
  starting_soc_pct: number;
  status: "draft" | "confirmed" | string;
  draft: DailyPlanDraft;
  result: {
    legs: DailyPlanLeg[];
    final_soc_pct: number | null;
    complete: boolean;
  } | null;
  confirmed_at?: string | null;
  created_at?: string | null;
};

export type DailyPlanChatResponse = {
  plan: DailyPlan;
  conversation: {
    reply: string;
    tool_calls: string[];
    llm_fallback_used: boolean;
    model_name?: string | null;
    error_code?: string | null;
  };
};

// --- Trip ---
export type TripSession = {
  id: string;
  user_id: string;
  driver_id: string;
  vehicle_id?: string;
  started_at: string;
  ended_at?: string;
  status: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_text?: string;
  destination_lat?: number;
  destination_lng?: number;
  confidence?: number;
  source?: string;
  starting_soc?: number | null;
};

export type TripWait = {
  id: string;
  started_at: string;
  device_started_at?: string | null;
  vehicle_charging: boolean;
  ended_at: string | null;
  device_ended_at?: string | null;
  resume_soc: number | null;
};

export type Trip = {
  id: string;
  vehicle_id?: string | null;
  driver_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  dest_lat?: number | null;
  dest_lng?: number | null;
  origin_label?: string | null;
  dest_label?: string | null;
  soc_start?: number | null;
  soc_end?: number | null;
  kwh_used?: number | null;
  distance_km?: number | null;
  route_taken?: string | null;
  recommended_route?: string | null;
  followed_nudge?: boolean | null;
  estimated?: boolean;
  confidence?: string | null;
  source?: string | null;
};

export type TripRoutePoint = {
  latitude: number;
  longitude: number;
  event_time: string;
  sequence_no: number;
};

export type TripDayDetail = {
  id: string;
  vehicle_id?: string | null;
  driver_id?: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  origin: { lat: number | null; lng: number | null };
  destination: { label: string | null; lat: number | null; lng: number | null };
  route_points: TripRoutePoint[];
  route_trace_available: boolean;
  route_trace_unavailable_reason: string | null;
  features: {
    distance_km: number | null;
    duration_minutes: number | null;
    avg_speed_kmh: number | null;
    max_speed_kmh: number | null;
    stops_count: number;
    total_dwell_minutes: number | null;
  } | null;
  telemetry_quality: {
    stored_windows: number;
    final_windows: number | null;
    actual_missing_windows: number | null;
    completeness_pct: number | null;
  };
  finalization: {
    state: string;
    processed_sequence_no: number;
    summary: Record<string, unknown> | null;
    completed_at: string | null;
  } | null;
  energy_label: {
    starting_soc_pct: number | null;
    ending_soc_pct: number | null;
    soc_delta_pct: number | null;
    actual_energy_consumed_wh: number | null;
    actual_wh_per_km: number | null;
    usable_kwh_snapshot: number | null;
    source: string;
    confidence: number;
    is_training_eligible: boolean;
    eligibility_reason: string;
  } | null;
  prediction: {
    route_energy_wh: number | null;
    wh_per_km: number | null;
    soc_consumed_pct: number | null;
    source: string | null;
    confidence: string | null;
    estimated: boolean;
  } | null;
  events: {
    by_severity: Record<string, number>;
    by_type: Record<string, number>;
    latest: Array<{ type: string; severity: string; confidence: number; created_at: string | null }>;
  };
};

export type TripDayResponse = {
  service_date: string;
  timezone: string;
  trips: TripDayDetail[];
};

export type ChargerOption = {
  place_id?: string | null;
  name?: string | null;
  distance_km?: number | null;
  rating?: number | null;
  charger_type?: string | null;
  amenities?: string[] | null;
  estimated_soc_gain?: number | null;
  availability_confirmed?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  google_maps_uri?: string | null;
  provider_source?: string | null;
  formatted_address?: string | null;
};

export type ChargerRecommendation = {
  recommended_charger: ChargerOption | null;
  reason: string;
  alternatives: ChargerOption[];
  fallback_used: boolean;
  charge_advice?: "charge_now" | "plan_charging" | "not_needed" | "soc_required";
  provider_source?: string;
  evaluated_soc_pct?: number;
  estimated_range_km?: number | null;
};

// --- GPS Raw Sample (§6.1) ---
export type GPSRawSample = {
  sequence?: number;
  lat: number;
  lng: number;
  timestamp: string;
  altitude?: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  provider?: string;
  mocked: boolean;
  app_version?: string;
  device_model?: string;
};

export type GPSBatchPayload = {
  batch_id: string;
  points: GPSRawSample[];
};

// --- SOC Reading (§SOC boundary) ---
export type SOCReading = {
  id: string;
  vehicle_id: string;
  driver_id?: string;
  value: number;
  source:
    | "manual"
    | "bluetooth_bms"
    | "oem_api"
    | "fleet_export"
    | "dashboard_confirmed";
  confidence: number;
  recorded_at: string;
  created_at: string;
};

export type SOCReadingRequest = {
  vehicle_id: string;
  value: number;
  source: string;
  confidence?: number;
  recorded_at?: string;
};

// --- Trip Prediction (§1 rule 3 — value + confidence + source + estimated) ---
export type PredictionValue = {
  value: number | null;
  confidence: string;
  source: string;
  estimated: boolean;
};

export type TripPrediction = {
  id: string;
  trip_id: string;
  vehicle_id?: string;
  wh_per_km: PredictionValue;
  route_energy_wh: PredictionValue;
  demand_score: PredictionValue;
  soc_consumed_pct: PredictionValue;
  range_km: PredictionValue | null; // NULL if no recent SOC
  uncertainty_lower?: number;
  uncertainty_upper?: number;
  ood_score?: number;
  provenance?: Record<string, any>;
  created_at: string;
};

// --- GPS Vehicle Summary ---
export type GPSVehicleSummary = {
  vehicle_id: string;
  vehicle_code: string;
  spec_complete: boolean;
  category?: string;
  latest_prediction?: {
    wh_per_km?: number;
    route_energy_wh?: number;
    demand_score?: number;
    soc_consumed_pct?: number;
    confidence?: string;
    source?: string;
    estimated: boolean;
    created_at?: string;
  };
  soc: {
    value?: number;
    source?: string;
    recorded_at?: string;
    is_recent: boolean;
  };
  estimated_range_km?: number;
  range_available: boolean;
};

// --- Mobile Me composite ---
export type MobileMe = {
  user: User;
  driver: Driver;
  vehicle: Vehicle | null;
  gps_summary?: GPSVehicleSummary;
  active_trip: TripSession | null;
  active_waiting: TripWait | null;
  active_charging: TripWait | null;
  alerts?: Alert[];
  latest_telemetry?: Telemetry;
};
