import { resolveBackendConfig } from "../backendConfig";

describe("backend configuration", () => {
  it("keeps an unconfigured Android debug build on the emulator host", () => {
    expect(resolveBackendConfig(true, "android", "", "")).toEqual({
      apiOrigin: "http://10.0.2.2:8001",
      websocketOrigin: "http://10.0.2.2:8001",
      useHostedBackend: false,
    });
  });

  it("uses explicit cloud origins in an Android debug pilot build", () => {
    expect(
      resolveBackendConfig(
        true,
        "android",
        "https://api.example.com/",
        "https://socket.example.com/"
      )
    ).toEqual({
      apiOrigin: "https://api.example.com",
      websocketOrigin: "https://socket.example.com",
      useHostedBackend: true,
    });
  });

  it("fails closed for an unconfigured release build", () => {
    expect(resolveBackendConfig(false, "android", "", "")).toEqual({
      apiOrigin: "https://api-not-configured.invalid",
      websocketOrigin: "https://api-not-configured.invalid",
      useHostedBackend: true,
    });
  });
});
