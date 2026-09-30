import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import VoiceInputButton from "../VoiceInputButton";
import { nativeVoice } from "../../services/voiceInput";

let mockVoiceListener: ((event: { type: string; text?: string }) => void) | null = null;

jest.mock("react-native", () => ({
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted" },
    request: jest.fn(async () => "granted"),
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));

jest.mock("react-native-vector-icons/MaterialCommunityIcons", () => "Icon");

jest.mock("../../services/voiceInput", () => ({
  createVoiceStartGuard: () => {
    let active = false;
    return {
      tryStart: () => {
        if (active) return false;
        active = true;
        return true;
      },
      release: () => { active = false; },
    };
  },
  mergeVoiceTranscript: (base: string, transcript: string) =>
    [base.trim(), transcript.trim()].filter(Boolean).join(" "),
  nativeVoice: {
    subscribe: jest.fn(),
    cancel: jest.fn(async () => undefined),
    start: jest.fn(async () => ({ started: true, on_device: true })),
    stop: jest.fn(async () => undefined),
  },
  voiceErrorMessage: () => "Voice failed",
  voiceSubscriptionFailureMessage: () => "Voice unavailable",
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("voice input completion", () => {
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    const original = console.error;
    consoleError = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      original(...args);
    });
  });

  afterAll(() => consoleError.mockRestore());

  beforeEach(() => {
    mockVoiceListener = null;
    (nativeVoice.start as jest.Mock).mockClear();
    (nativeVoice.cancel as jest.Mock).mockClear();
    const subscribe = nativeVoice.subscribe as jest.Mock;
    subscribe.mockClear();
    subscribe.mockImplementation(listener => {
      mockVoiceListener = listener;
      return { remove: jest.fn() };
    });
  });

  it("passes the completed transcript to the destination search callback", async () => {
    const onChangeText = jest.fn();
    const onFinalText = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <VoiceInputButton
          value="Surat"
          onChangeText={onChangeText}
          onFinalText={onFinalText}
          label="Speak destination"
        />
      );
    });

    await act(async () => {
      await renderer.root.findByProps({ testID: "voice-input-button" }).props.onPress();
    });
    act(() => mockVoiceListener?.({ type: "partial", text: "railway" }));
    expect(onFinalText).not.toHaveBeenCalled();

    act(() => mockVoiceListener?.({ type: "final", text: "railway station" }));
    expect(onChangeText).toHaveBeenLastCalledWith("Surat railway station");
    expect(onFinalText).toHaveBeenCalledWith("Surat railway station");
    act(() => renderer.unmount());
  });

  it("does not cancel recognition when parent callback identities change", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <VoiceInputButton value="Surat" onChangeText={jest.fn()} onFinalText={jest.fn()} />
      );
    });

    await act(async () => {
      renderer.update(
        <VoiceInputButton value="Surat railway" onChangeText={jest.fn()} onFinalText={jest.fn()} />
      );
    });

    expect(nativeVoice.subscribe).toHaveBeenCalledTimes(1);
    expect(nativeVoice.cancel).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
