import { googleAuthErrorMessage } from "../googleAuthError";

describe("Google authentication errors", () => {
  it("tells a cancelled user that sign-in can be retried", () => {
    expect(
      googleAuthErrorMessage({ code: "GOOGLE_SIGN_IN_CANCELLED" })
    ).toBe("Google sign-in was cancelled. Tap Continue with Google to try again.");
  });

  it("gives an actionable message when the credential provider is unavailable", () => {
    expect(
      googleAuthErrorMessage({ code: "GOOGLE_PROVIDER_CONFIGURATION" })
    ).toBe(
      "Google sign-in provider is unavailable. Update Google Play services and try again. (GOOGLE_PROVIDER_CONFIGURATION)"
    );
  });

  it("retains a bounded native failure code and message for diagnosis", () => {
    expect(
      googleAuthErrorMessage({
        code: "GOOGLE_SIGN_IN_FAILED",
        message: "Credential response was interrupted",
      })
    ).toBe(
      "Google sign-in failed (GOOGLE_SIGN_IN_FAILED): Credential response was interrupted"
    );
  });
});
