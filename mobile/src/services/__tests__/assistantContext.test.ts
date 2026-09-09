import { buildAssistantRequest, assistantEvidenceLabel } from "../assistantContext";

describe("assistant location grounding", () => {
  it("includes only finite bounded phone coordinates in the API payload", () => {
    expect(buildAssistantRequest("driver-1", "vehicle-1", "Nearest charger?", {
      lat: 21.17,
      lng: 72.83,
    })).toEqual({
      driver_id: "driver-1",
      vehicle_id: "vehicle-1",
      message: "Nearest charger?",
      location: { lat: 21.17, lng: 72.83 },
    });
    expect(buildAssistantRequest("driver-1", "vehicle-1", "Range?", {
      lat: 91,
      lng: 72.83,
    })).toEqual({
      driver_id: "driver-1",
      vehicle_id: "vehicle-1",
      message: "Range?",
    });
  });

  it("states exactly which authoritative context was available", () => {
    expect(assistantEvidenceLabel({
      llm_used: true,
      tools_called: ["gps_vehicle_summary", "current_location_context", "nearby_chargers"],
      location_used: true,
      charger_context_used: true,
    })).toBe("LLM response · vehicle data + phone GPS + verified charger listings");
    expect(assistantEvidenceLabel({
      llm_used: false,
      tools_called: ["gps_vehicle_summary"],
      location_used: false,
      charger_context_used: false,
    })).toBe("Deterministic fallback · vehicle data · live location unavailable");
  });
});
