import {
  parseLiveStateMessage,
  reconnectDelayMs,
  websocketProtocols,
  websocketUrl,
} from "../liveSocket";

describe("live state socket helpers", () => {
  it("builds an encoded recovery URL", () => {
    expect(websocketUrl("https://api.example.com", "vehicle/1", 7)).toBe(
      "wss://api.example.com/ws/v2/vehicles/vehicle%2F1?since_version=7"
    );
    expect(websocketProtocols("a.b-c_d")).toEqual([
      "trickee-v2",
      "trickee-auth.a.b-c_d",
    ]);
  });

  it("accepts only valid monotonic snapshot messages", () => {
    const parsed = parseLiveStateMessage(
      JSON.stringify({
        type: "update",
        data: {
          vehicle_id: "EV-1",
          state_version: 8,
          sequence_no: 12,
          freshness: "LIVE",
          gps_available: true,
          location: { lat: 21.17, lng: 72.83 },
          projection_status: "CURRENT",
        },
      }),
      7
    );

    expect(parsed?.state_version).toBe(8);
    expect(
      parseLiveStateMessage(JSON.stringify({ type: "update", data: parsed }), 8)
    ).toBeNull();
    expect(parseLiveStateMessage("pong", 8)).toBeNull();
    expect(parseLiveStateMessage("not-json", 8)).toBeNull();
  });

  it("bounds exponential reconnect delay and jitter", () => {
    expect(reconnectDelayMs(0, 0)).toBe(1000);
    expect(reconnectDelayMs(3, 0)).toBe(8000);
    expect(reconnectDelayMs(99, 1)).toBe(30000);
  });
});
