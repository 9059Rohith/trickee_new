import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../constants/Colors";
import DetailHeader from "../../components/DetailHeader";
import BackgroundLogo from "../../components/BackgroundLogo";
import VoiceInputButton from "../../components/VoiceInputButton";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api } from "../../services/api";
import { assistantEvidenceLabel, buildAssistantRequest } from "../../services/assistantContext";
import { currentPlannerLocation } from "../../services/telemetryNative";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  evidence?: string;
  retryPrompt?: string;
};

const QUICK_PROMPTS = [
  "How far can I drive with my current SOC?",
  "How efficient was my latest trip?",
  "What vehicle data is available right now?",
];

const AIAssistantScreen: React.FC = () => {
  const { token } = useAuth();
  const { driver, vehicle } = useLiveData();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask about GPS-estimated efficiency, trip energy, demand, or SOC-based range.",
    },
  ]);

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || !token || !driver || !vehicle || sending) {
      return;
    }
    setInput("");
    setMessages((items) => [
      ...items,
      { id: `user-${Date.now()}`, role: "user", text },
    ]);
    setSending(true);
    try {
      const location = await currentPlannerLocation().catch(() => null);
      const reply = await api.assistantMessage(
        token,
        buildAssistantRequest(driver.id, vehicle.id, text, location)
      );
      setMessages((items) => [
        ...items,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: reply.answer,
          evidence: assistantEvidenceLabel(reply),
        },
      ]);
    } catch {
      setMessages((items) => [
        ...items,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text: "I could not reach the verified vehicle tools. Your question is still available to retry.",
          retryPrompt: text,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={24}
    >
      <BackgroundLogo />
      <DetailHeader
        title="AI Intelligence"
        subtitle="Grounded in GPS-first vehicle data"
      />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={styles.quickPrompts}>
          {QUICK_PROMPTS.map(prompt => (
            <TouchableOpacity
              key={prompt}
              accessibilityRole="button"
              accessibilityLabel={prompt}
              style={styles.promptChip}
              disabled={sending}
              onPress={() => send(prompt)}
            >
              <Text style={styles.promptChipText}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {messages.map((message) => (
          <View
            key={message.id}
            style={[
              styles.bubble,
              message.role === "user" ? styles.user : styles.assistant,
            ]}
          >
            <Text
              style={
                message.role === "user" ? styles.userText : styles.assistantText
              }
            >
              {message.text}
            </Text>
            {message.role === "assistant" && message.evidence ? (
              <Text style={styles.evidence}>{message.evidence}</Text>
            ) : null}
            {message.retryPrompt ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Retry this question"
                style={styles.retryButton}
                disabled={sending}
                onPress={() => send(message.retryPrompt)}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {sending && (
          <View style={[styles.bubble, styles.assistant]}>
            <ActivityIndicator color={Colors.trickeeYellow} />
          </View>
        )}
      </ScrollView>
      <View style={styles.voiceRow}>
        <VoiceInputButton value={input} onChangeText={setInput} label="Speak a question" />
      </View>
      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Your question</Text>
          <TextInput
            testID="assistant-message-input"
            accessibilityLabel="Question for AI Intelligence"
            value={input}
            onChangeText={setInput}
            style={styles.input}
            placeholder="Ask about your EV…"
            placeholderTextColor={Colors.secondaryText}
            multiline
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => {
              send();
            }}
          />
        </View>
        <TouchableOpacity
          testID="assistant-send"
          accessibilityRole="button"
          accessibilityLabel="Send question"
          accessibilityState={{ disabled: sending || !input.trim() }}
          style={styles.send}
          disabled={sending || !input.trim()}
          onPress={() => {
            send();
          }}
        >
          <Icon name="send" size={20} color={Colors.buttonText} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  messages: { padding: 18, gap: 12, paddingBottom: 24 },
  quickPrompts: { gap: 8, marginBottom: 4 },
  promptChip: { minHeight: 44, justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: Colors.premiumCardBorder, paddingHorizontal: 13, paddingVertical: 9 },
  promptChipText: { color: Colors.neonBlue, fontSize: 14, fontWeight: "700" },
  bubble: {
    maxWidth: "84%",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  user: { alignSelf: "flex-end", backgroundColor: Colors.trickeeYellow },
  assistant: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  userText: { color: Colors.buttonText, fontWeight: "700" },
  assistantText: { color: Colors.white, lineHeight: 20 },
  evidence: { color: Colors.secondaryText, fontSize: 10, lineHeight: 15, marginTop: 7 },
  retryButton: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginTop: 8, paddingHorizontal: 4 },
  retryText: { color: Colors.trickeeYellow, fontSize: 14, fontWeight: "900" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  voiceRow: { paddingHorizontal: 16, paddingTop: 8 },
  inputGroup: { flex: 1, gap: 5 },
  inputLabel: { color: Colors.secondaryText, fontSize: 14, fontWeight: "700", marginLeft: 8 },
  input: {
    minHeight: 48,
    maxHeight: 112,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: Colors.white,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.trickeeYellow,
  },
});

export default AIAssistantScreen;
