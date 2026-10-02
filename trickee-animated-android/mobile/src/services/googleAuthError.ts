type NativeGoogleAuthError = {
  code?: unknown;
  message?: unknown;
};

const boundedText = (value: unknown, maxLength: number): string =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";

export function googleAuthErrorMessage(error: unknown): string {
  const native = (error ?? {}) as NativeGoogleAuthError;
  const code = boundedText(native.code, 80);

  if (code === "GOOGLE_SIGN_IN_CANCELLED") {
    return "Google sign-in was cancelled. Tap Continue with Google to try again.";
  }
  if (code === "GOOGLE_PROVIDER_CONFIGURATION") {
    return "Google sign-in provider is unavailable. Update Google Play services and try again. (GOOGLE_PROVIDER_CONFIGURATION)";
  }
  if (code === "GOOGLE_CREDENTIALS_UNSUPPORTED") {
    return "Google sign-in is not supported by this device. Update Android and Google Play services. (GOOGLE_CREDENTIALS_UNSUPPORTED)";
  }

  const message = boundedText(native.message, 180);
  if (code && message) return `Google sign-in failed (${code}): ${message}`;
  if (code) return `Google sign-in failed (${code}).`;
  return "Unable to sign in with Google.";
}
