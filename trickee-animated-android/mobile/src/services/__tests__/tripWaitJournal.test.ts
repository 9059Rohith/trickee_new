jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  adoptServerTripWait,
  beginLocalTripWait,
  finishLocalTripWait,
  flushTripWaitJournal,
  localTripWaitState,
} from "../tripWaitJournal";

describe("durable charging-stop journal", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("keeps a charging stop locally through an offline replay and sends start before resume", async () => {
    await beginLocalTripWait("trip-1", "wait-1", true);
    const unavailable = jest.fn().mockRejectedValue(new Error("offline"));
    expect((await flushTripWaitJournal("trip-1", unavailable, unavailable)).pendingCount).toBe(1);
    expect((await localTripWaitState("trip-1")).active?.vehicle_charging).toBe(true);

    await finishLocalTripWait("trip-1", "wait-1", 73);
    const sent: string[] = [];
    const sendStart = async () => { sent.push("start"); };
    const sendResume = async () => { sent.push("resume"); };
    expect((await flushTripWaitJournal("trip-1", sendStart, sendResume)).pendingCount).toBe(0);
    expect(sent).toEqual(["start", "resume"]);
    expect((await localTripWaitState("trip-1")).closedIds).toEqual(["wait-1"]);
  });

  it("cannot mark a charging stop complete without a new SOC", async () => {
    await beginLocalTripWait("trip-2", "wait-2", true);
    await expect(finishLocalTripWait("trip-2", "wait-2")).rejects.toThrow("Post-charge SOC is required");
    expect((await localTripWaitState("trip-2")).active?.id).toBe("wait-2");
  });

  it("does not invent a SOC reading when the rider did not charge", async () => {
    await beginLocalTripWait("trip-3", "wait-3", false);
    await finishLocalTripWait("trip-3", "wait-3");
    const payloads: Array<{ resume_soc?: number }> = [];
    await flushTripWaitJournal("trip-3", async () => {}, async (_tripId, _waitId, soc) => {
      payloads.push(soc === undefined ? {} : { resume_soc: soc });
    });
    expect(payloads).toEqual([{}]);
  });

  it("replays the original device timestamps after coming back online", async () => {
    await beginLocalTripWait("trip-time", "wait-time", true);
    await finishLocalTripWait("trip-time", "wait-time", 71);
    const saved = JSON.parse((await AsyncStorage.getItem("trickee.trip-waits.v1"))!)[0];
    const sent: Array<unknown[]> = [];
    await flushTripWaitJournal(
      "trip-time",
      async (...args) => { sent.push(args); },
      async (...args) => { sent.push(args); }
    );
    expect(sent).toEqual([
      ["trip-time", "wait-time", true, saved.started_at],
      ["trip-time", "wait-time", 71, saved.ended_at],
    ]);
  });

  it("can resume an already-synced stop offline without replaying its start", async () => {
    await adoptServerTripWait("trip-server", "wait-server", true, "2026-09-14T08:00:00Z");
    await finishLocalTripWait("trip-server", "wait-server", 69);
    const start = jest.fn().mockRejectedValue(new Error("start should not repeat"));
    const resumed: number[] = [];
    const result = await flushTripWaitJournal("trip-server", start, async (_trip, _wait, soc) => {
      if (soc !== undefined) resumed.push(soc);
    });
    expect(result.pendingCount).toBe(0);
    expect(start).not.toHaveBeenCalled();
    expect(resumed).toEqual([69]);
  });

  it("lets the rider record post-charge SOC while an upload is still waiting", async () => {
    await beginLocalTripWait("trip-slow", "wait-slow", true);
    let releaseUpload!: () => void;
    let uploadStarted!: () => void;
    const started = new Promise<void>(resolve => { uploadStarted = resolve; });
    const blocked = new Promise<void>(resolve => { releaseUpload = resolve; });
    const flushing = flushTripWaitJournal("trip-slow", async () => {
      uploadStarted();
      await blocked;
    }, async () => {});
    await started;
    try {
      await Promise.race([
        finishLocalTripWait("trip-slow", "wait-slow", 75),
        new Promise((_, reject) => setTimeout(() => reject(new Error("local SOC blocked by network")), 200)),
      ]);
    } finally {
      releaseUpload();
      await flushing;
    }
    expect((await localTripWaitState("trip-slow")).active).toBeNull();
  });

  it("backs up corrupt evidence and blocks unsafe reconciliation", async () => {
    await AsyncStorage.setItem("trickee.trip-waits.v1", "{broken");
    await expect(localTripWaitState("trip-4")).rejects.toThrow("Trip stop history is unavailable");
    expect(await AsyncStorage.getItem("trickee.trip-waits.corrupt.v1")).toBe("{broken");
  });
});
