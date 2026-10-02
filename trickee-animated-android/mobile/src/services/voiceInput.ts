import { NativeEventEmitter, NativeModules, Platform } from "react-native";
export { mergeVoiceTranscript, voiceErrorMessage } from "./voiceInputPolicy";

export type VoiceInputEvent = {
  type: "listening" | "partial" | "final" | "processing" | "end" | "error";
  text?: string;
  code?: string;
  message?: string;
  on_device?: boolean;
};

type NativeVoiceModule = {
  isAvailable(): Promise<{ available: boolean; on_device_available: boolean }>;
  start(locale: string): Promise<{ started: boolean; on_device: boolean }>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const module = (): NativeVoiceModule => {
  const value = NativeModules.TrickeeVoiceRecognition as NativeVoiceModule | undefined;
  if (Platform.OS !== "android" || !value) {
    throw new Error("Voice entry is not available on this device. Continue by typing.");
  }
  return value;
};

export const nativeVoice = {
  isAvailable: () => module().isAvailable(),
  start: (locale: string) => module().start(locale),
  stop: () => module().stop(),
  cancel: () => module().cancel(),
  subscribe: (listener: (event: VoiceInputEvent) => void) => {
    const nativeModule = module();
    const emitter = new NativeEventEmitter(nativeModule as never);
    return emitter.addListener("TrickeeVoiceRecognitionEvent", listener);
  },
};
