import { mergeVoiceTranscript, voiceErrorMessage } from "../voiceInputPolicy";

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
});
