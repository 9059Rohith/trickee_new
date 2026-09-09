type Coordinates = { lat: number; lng: number };

type AssistantReplyEvidence = {
  llm_used: boolean;
  tools_called?: string[];
  location_used?: boolean;
  charger_context_used?: boolean;
};

const validCoordinates = (location?: Coordinates | null) =>
  !!location &&
  Number.isFinite(location.lat) &&
  Number.isFinite(location.lng) &&
  location.lat >= -90 &&
  location.lat <= 90 &&
  location.lng >= -180 &&
  location.lng <= 180;

export function buildAssistantRequest(
  driverId: string,
  vehicleId: string,
  message: string,
  location?: Coordinates | null
) {
  return {
    driver_id: driverId,
    vehicle_id: vehicleId,
    message,
    ...(validCoordinates(location) ? { location } : {}),
  };
}

export function assistantEvidenceLabel(reply: AssistantReplyEvidence): string {
  const prefix = reply.llm_used ? "LLM response" : "Deterministic fallback";
  const sources = ["vehicle data"];
  if (reply.location_used) {
    sources.push("phone GPS");
  } else {
    sources.push("live location unavailable");
  }
  if (reply.charger_context_used) {
    sources.push("verified charger listings");
  }
  return `${prefix} · ${sources.join(" + ").replace(" + live location unavailable", " · live location unavailable")}`;
}
