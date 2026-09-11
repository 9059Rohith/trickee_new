export function mergeVoiceTranscript(existing: string, transcript: string): string {
  const left = existing.trim();
  const right = transcript.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export function voiceErrorMessage(code?: string): string {
  switch (code) {
    case "permission_denied":
      return "Allow microphone permission to use voice entry, or continue by typing.";
    case "recognizer_unavailable":
    case "locale_unavailable":
      return "Voice recognition is unavailable on this phone. Continue by typing.";
    case "network":
      return "Voice recognition could not reach its service. Check your connection or continue by typing.";
    case "silence":
    case "no_match":
      return "I could not hear a clear schedule. Try again or continue by typing.";
    case "recognizer_busy":
      return "The phone's voice recognizer is busy. Wait a moment and try again.";
    default:
      return "Voice entry stopped unexpectedly. Try again or continue by typing.";
  }
}
