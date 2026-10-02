jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueNudgeOutcome,
  flushNudgeOutcomes,
  pendingNudgeOutcomeCount,
} from "../nudgeStorage";

describe("durable nudge outcome storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("deduplicates an action and keeps it until the backend acknowledges it", async () => {
    await enqueueNudgeOutcome("nudge-1", "accepted", {
      selected_route_id: "ring-road",
    });
    await enqueueNudgeOutcome("nudge-1", "accepted", {
      selected_route_id: "ring-road",
    });

    expect(await pendingNudgeOutcomeCount()).toBe(1);

    const unavailable = jest.fn().mockRejectedValue(new Error("offline"));
    await expect(flushNudgeOutcomes(unavailable)).resolves.toEqual({
      flushed: 0,
      remaining: 1,
    });
    expect(await pendingNudgeOutcomeCount()).toBe(1);

    const accepted = jest.fn().mockResolvedValue(undefined);
    await expect(flushNudgeOutcomes(accepted)).resolves.toEqual({
      flushed: 1,
      remaining: 0,
    });
    expect(accepted).toHaveBeenCalledWith(
      "nudge-1",
      expect.objectContaining({ event: "accepted" })
    );
  });

  it("preserves malformed queue bytes before recovering an empty queue", async () => {
    await AsyncStorage.setItem("trickee.route-nudges.outcomes.v1", "{broken");

    expect(await pendingNudgeOutcomeCount()).toBe(0);
    expect(
      await AsyncStorage.getItem("trickee.route-nudges.outcomes.corrupt.v1")
    ).toBe("{broken");
  });
});
