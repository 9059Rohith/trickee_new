jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import { beginWaitLocally, finishWaitLocally } from "../tripWaitActions";
import { localTripWaitState } from "../tripWaitJournal";

describe("nonblocking trip stop actions", () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it("makes a charging stop usable before a network request finishes", async () => {
    const never = () => new Promise<void>(() => {});
    await Promise.race([
      beginWaitLocally("trip-1", "wait-1", true, never),
      new Promise((_, reject) => setTimeout(() => reject(new Error("waited for network")), 200)),
    ]);
    expect((await localTripWaitState("trip-1")).active?.vehicle_charging).toBe(true);
  });

  it("returns from post-charge SOC entry before the queued sync completes", async () => {
    await beginWaitLocally("trip-2", "wait-2", true, async () => {});
    const never = () => new Promise<void>(() => {});
    await Promise.race([
      finishWaitLocally("trip-2", "wait-2", 72, never),
      new Promise((_, reject) => setTimeout(() => reject(new Error("waited for network")), 200)),
    ]);
    expect((await localTripWaitState("trip-2")).active).toBeNull();
    expect((await localTripWaitState("trip-2")).pendingCount).toBe(2);
  });
});
