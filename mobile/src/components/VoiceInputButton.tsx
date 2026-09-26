import React, { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import {
  createVoiceStartGuard,
  mergeVoiceTranscript,
  nativeVoice,
  voiceErrorMessage,
  voiceSubscriptionFailureMessage,
} from "../services/voiceInput";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  locale?: string;
};

const VoiceInputButton: React.FC<Props> = ({ value, onChangeText, label = "Speak instead", locale = "en-IN" }) => {
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const baseText = useRef("");
  const startGuard = useRef(createVoiceStartGuard());

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = nativeVoice.subscribe(event => {
        if (event.type === "starting") {
          setStarting(true);
          setStatus(event.code === "platform_fallback" ? "Switching voice service..." : "Starting microphone...");
        } else if (event.type === "listening") {
          setStarting(false);
          setListening(true);
          setStatus(event.on_device ? "Listening on this phone..." : "Listening...");
        } else if ((event.type === "partial" || event.type === "final" || event.type === "completed") && event.text) {
          onChangeText(mergeVoiceTranscript(baseText.current, event.text));
          const completed = event.type === "final" || event.type === "completed";
          setStatus(completed ? "Transcript added. Review it before continuing." : "Listening...");
          if (completed) {
            setStarting(false);
            setListening(false);
            startGuard.current.release();
          }
        } else if (event.type === "processing") {
          setStarting(false);
          setStatus("Transcribing...");
        } else if (event.type === "error" || event.type === "failed") {
          setStarting(false);
          setListening(false);
          setStatus(voiceErrorMessage(event.code));
          startGuard.current.release();
        } else if (event.type === "end") {
          setStarting(false);
          setListening(false);
          startGuard.current.release();
        }
      });
    } catch {
      setStatus(voiceSubscriptionFailureMessage());
    }
    return () => {
      subscription?.remove();
      try {
        nativeVoice.cancel().catch(() => undefined);
      } catch {
        // The optional native module may be unavailable on unsupported builds.
      }
    };
  }, [onChangeText]);

  const start = async () => {
    if (Platform.OS !== "android") {
      setStatus("Voice entry is available in the Android app. Continue by typing.");
      return;
    }
    if (starting) return;
    if (listening) {
      await nativeVoice.stop().catch(() => undefined);
      setStatus("Transcribing...");
      return;
    }
    if (!startGuard.current.tryStart()) return;

    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: "Speak your schedule",
      message: "Trickee uses the microphone only during this voice-entry session. Raw audio is not stored by Trickee.",
      buttonPositive: "Allow microphone",
      buttonNegative: "Not now",
    });
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      startGuard.current.release();
      setStatus(voiceErrorMessage("permission_denied"));
      return;
    }

    baseText.current = value;
    setStarting(true);
    setStatus("Starting microphone...");
    try {
      await nativeVoice.start(locale);
    } catch (error) {
      setStarting(false);
      setListening(false);
      startGuard.current.release();
      const code = typeof error === "object" && error && "code" in error ? String(error.code).toLowerCase() : undefined;
      setStatus(voiceErrorMessage(code));
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        testID="voice-input-button"
        accessibilityRole="button"
        accessibilityLabel={listening ? "Stop voice entry" : starting ? "Starting voice entry" : label}
        accessibilityHint="Uses the microphone only for this voice entry session"
        accessibilityState={{ selected: listening, disabled: starting }}
        disabled={starting}
        style={[styles.button, listening && styles.active, starting && styles.disabled]}
        onPress={start}
      >
        <Icon name={listening ? "stop-circle-outline" : "microphone-outline"} size={21} color={listening ? Colors.darkText : Colors.neonBlue} />
        <Text style={[styles.label, listening && styles.activeLabel]}>{listening ? "Stop and transcribe" : starting ? "Starting..." : label}</Text>
      </TouchableOpacity>
      {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  button: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, borderColor: Colors.neonBlue, paddingHorizontal: 14 },
  active: { backgroundColor: Colors.trickeeYellow, borderColor: Colors.trickeeYellow },
  disabled: { opacity: 0.65 },
  label: { color: Colors.neonBlue, fontSize: 14, fontWeight: "900" },
  activeLabel: { color: Colors.darkText },
  status: { color: Colors.secondaryText, fontSize: 13, lineHeight: 18 },
});

export default VoiceInputButton;
