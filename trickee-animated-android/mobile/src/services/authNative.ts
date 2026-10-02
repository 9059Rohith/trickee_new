import { NativeModules, Platform } from "react-native";

type StoredSession = { accessToken: string; refreshToken?: string | null };

function module() {
  const value = NativeModules.TrickeeGoogleAuth;
  if (Platform.OS !== "android" || !value) {
    throw new Error(
      "Secure Google sign-in is available only in the Android app."
    );
  }
  return value;
}

export const nativeAuth = {
  googleCredential: () =>
    module().getGoogleIdToken() as Promise<{ idToken: string; nonce: string }>,
  save: (session: StoredSession) =>
    module().saveSession(session) as Promise<void>,
  load: () => module().loadSession() as Promise<StoredSession | null>,
  clear: () => module().clearSession() as Promise<void>,
};
