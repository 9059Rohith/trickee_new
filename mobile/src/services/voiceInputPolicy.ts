export function mergeVoiceTranscript(existing: string, transcript: string): string {
  const left = existing.trim();
  const right = transcript.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export function createVoiceStartGuard() {
  let active = false;
  return {
    tryStart(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    release(): void {
      active = false;
    },
  };
}

export function voiceSubscriptionFailureMessage(): string {
  return "Voice entry is not connected in this app build. Continue by typing.";
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
    case "start_timeout":
      return "The microphone did not become ready. Try again or continue by typing.";
    default:
      return "Voice entry stopped unexpectedly. Try again or continue by typing.";
  }
}
