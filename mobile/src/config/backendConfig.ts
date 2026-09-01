export type BackendConfig = {
  apiOrigin: string;
  websocketOrigin: string;
  useHostedBackend: boolean;
};

function normalizedOrigin(value?: string): string {
  return (value || "").trim().replace(/\/+$/, "");
}

export function resolveBackendConfig(
  isDev: boolean,
  platform: string,
  nativeApiOrigin?: string,
  nativeWebsocketOrigin?: string
): BackendConfig {
  const configuredApiOrigin = normalizedOrigin(nativeApiOrigin);
  if (isDev && !configuredApiOrigin) {
    const localOrigin =
      platform === "android" ? "http://10.0.2.2:8001" : "http://127.0.0.1:8001";
    return {
      apiOrigin: localOrigin,
      websocketOrigin: localOrigin,
      useHostedBackend: false,
    };
  }

  const apiOrigin = configuredApiOrigin || "https://api-not-configured.invalid";
  return {
    apiOrigin,
    websocketOrigin: normalizedOrigin(nativeWebsocketOrigin) || apiOrigin,
    useHostedBackend: true,
  };
}
