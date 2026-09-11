import React, { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import { mergeVoiceTranscript, nativeVoice, voiceErrorMessage } from "../services/voiceInput";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  locale?: string;
};

const VoiceInputButton: React.FC<Props> = ({ value, onChangeText, label = "Speak instead", locale = "en-IN" }) => {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const baseText = useRef("");

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = nativeVoice.subscribe(event => {
        if (event.type === "listening") {
          setListening(true);
          setStatus(event.on_device ? "Listening on this phone..." : "Listening...");
        } else if ((event.type === "partial" || event.type === "final") && event.text) {
          onChangeText(mergeVoiceTranscript(baseText.current, event.text));
          setStatus(event.type === "final" ? "Transcript added. Review it before continuing." : "Listening...");
          if (event.type === "final") setListening(false);
        } else if (event.type === "processing") {
          setStatus("Transcribing...");
        } else if (event.type === "error") {
          setListening(false);
          setStatus(voiceErrorMessage(event.code));
        } else if (event.type === "end") {
          setListening(false);
        }
      });
    } catch {
      setStatus(null);
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
    if (listening) {
      await nativeVoice.stop().catch(() => undefined);
      setStatus("Transcribing...");
      return;
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Speak your schedule",
        message: "Trickee uses the microphone only while you hold a voice-entry session. Raw audio is not stored by Trickee.",
        buttonPositive: "Allow microphone",
        buttonNegative: "Not now",
      }
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      setStatus(voiceErrorMessage("permission_denied"));
      return;
    }

    baseText.current = value;
    setStatus("Starting microphone...");
    try {
      await nativeVoice.start(locale);
    } catch (error) {
      setListening(false);
      const code = typeof error === "object" && error && "code" in error ? String(error.code).toLowerCase() : undefined;
      setStatus(voiceErrorMessage(code));
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        testID="voice-input-button"
        accessibilityRole="button"
        accessibilityLabel={listening ? "Stop voice entry" : label}
        accessibilityHint="Uses the microphone only for this voice entry session"
        accessibilityState={{ selected: listening }}
        style={[styles.button, listening && styles.active]}
        onPress={start}
      >
        <Icon name={listening ? "stop-circle-outline" : "microphone-outline"} size={21} color={listening ? Colors.darkText : Colors.neonBlue} />
        <Text style={[styles.label, listening && styles.activeLabel]}>{listening ? "Stop and transcribe" : label}</Text>
      </TouchableOpacity>
      {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  button: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, borderColor: Colors.neonBlue, paddingHorizontal: 14 },
  active: { backgroundColor: Colors.trickeeYellow, borderColor: Colors.trickeeYellow },
  label: { color: Colors.neonBlue, fontSize: 14, fontWeight: "900" },
  activeLabel: { color: Colors.darkText },
  status: { color: Colors.secondaryText, fontSize: 13, lineHeight: 18 },
});

export default VoiceInputButton;
