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
  soc: number;
  speed: number;
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
};

export type ChargerOption = {
  name?: string | null;
  distance_km?: number | null;
  rating?: number | null;
  charger_type?: string | null;
  amenities?: string[] | null;
  estimated_soc_gain?: number | null;
  availability_confirmed?: boolean | null;
  lat?: number | null;
  lng?: number | null;
};

export type ChargerRecommendation = {
  recommended_charger: ChargerOption | null;
  reason: string;
  alternatives: ChargerOption[];
  fallback_used: boolean;
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
  active_waiting: any;
  active_charging: any;
  alerts?: Alert[];
  latest_telemetry?: Telemetry;
};
