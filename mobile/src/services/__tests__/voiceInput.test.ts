import {
  createVoiceStartGuard,
  mergeVoiceTranscript,
  voiceErrorMessage,
  voiceSubscriptionFailureMessage,
} from "../voiceInputPolicy";

describe("voice input presentation", () => {
  it("appends a transcript without erasing text the driver already entered", () => {
    expect(mergeVoiceTranscript("Office at 9", "client at 12:30")).toBe(
      "Office at 9 client at 12:30"
    );
    expect(mergeVoiceTranscript("", "Home by 7")).toBe("Home by 7");
  });

  it("maps recognizer failures to actionable driver messages", () => {
    expect(voiceErrorMessage("permission_denied")).toContain("microphone permission");
    expect(voiceErrorMessage("recognizer_unavailable")).toContain("typing");
    expect(voiceErrorMessage("network")).toContain("connection");
    expect(voiceErrorMessage("unknown")).toContain("Try again");
  });

  it("keeps subscription failure visible instead of making the button appear dead", () => {
    expect(voiceSubscriptionFailureMessage()).toContain("Continue by typing");
    expect(voiceSubscriptionFailureMessage()).toContain("not connected");
  });

  it("keeps typed text stable through fallback and appends partial or final text once", () => {
    const typed = "Office at 9";
    expect(mergeVoiceTranscript(typed, "")).toBe(typed);
    expect(mergeVoiceTranscript(typed, "client at noon")).toBe(
      "Office at 9 client at noon"
    );
    expect(mergeVoiceTranscript(typed, "client at noon")).toBe(
      "Office at 9 client at noon"
    );
  });

  it("blocks a second native start while the first start is pending", () => {
    const guard = createVoiceStartGuard();
    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    guard.release();
    expect(guard.tryStart()).toBe(true);
  });
});
