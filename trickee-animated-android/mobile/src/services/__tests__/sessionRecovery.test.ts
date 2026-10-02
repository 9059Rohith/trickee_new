import { runWithSessionRecovery, SessionRestorer } from "../sessionRecovery";

const expired = { accessToken: "expired", refreshToken: "refresh-old" };
const refreshed = {
  access_token: "access-new",
  refresh_token: "refresh-new",
  user: { id: "user-1", email: "rhythm@trickee.co.in" },
};

describe("session recovery", () => {
  it("renews an expired access token without clearing the signed-in session", async () => {
    const saved: Array<{ accessToken: string; refreshToken?: string | null }> = [];
    let cleared = 0;
    const restorer = new SessionRestorer({
      load: async () => expired,
      verify: async () => {
        throw { isAuth: true, status: 401 };
      },
      refresh: async () => refreshed,
      save: async (session) => {
        saved.push(session);
      },
      clear: async () => {
        cleared += 1;
      },
    });

    await expect(restorer.recover()).resolves.toEqual({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      user: refreshed.user,
    });
    expect(saved).toEqual([{ accessToken: "access-new", refreshToken: "refresh-new" }]);
    expect(cleared).toBe(0);
  });

  it("coalesces concurrent 401 recovery into one refresh-token rotation", async () => {
    let refreshCalls = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const restorer = new SessionRestorer({
      load: async () => expired,
      verify: async () => {
        throw { isAuth: true, status: 401 };
      },
      refresh: async () => {
        refreshCalls += 1;
        await refreshGate;
        return refreshed;
      },
      save: async () => {},
      clear: async () => {},
    });

    const first = restorer.recover();
    const second = restorer.recover();
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { accessToken: "access-new", refreshToken: "refresh-new", user: refreshed.user },
      { accessToken: "access-new", refreshToken: "refresh-new", user: refreshed.user },
    ]);
    expect(refreshCalls).toBe(1);
  });

  it("retries a protected operation once with the recovered access token", async () => {
    const seenTokens: string[] = [];
    const operation = async (accessToken: string) => {
      seenTokens.push(accessToken);
      if (accessToken === "expired") throw { isAuth: true, status: 401 };
      return "completed";
    };

    await expect(
      runWithSessionRecovery("expired", async () => "access-new", operation)
    ).resolves.toBe("completed");
    expect(seenTokens).toEqual(["expired", "access-new"]);
  });

  it("clears an expired legacy session that has no refresh token", async () => {
    let cleared = 0;
    const restorer = new SessionRestorer({
      load: async () => ({ accessToken: "expired" }),
      verify: async () => {
        throw { isAuth: true, status: 401 };
      },
      refresh: async () => refreshed,
      save: async () => {},
      clear: async () => {
        cleared += 1;
      },
    });

    await expect(restorer.recover()).resolves.toBeNull();
    expect(cleared).toBe(1);
  });
});
