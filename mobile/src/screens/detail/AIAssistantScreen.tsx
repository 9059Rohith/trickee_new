import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../constants/Colors";
import DetailHeader from "../../components/DetailHeader";
import BackgroundLogo from "../../components/BackgroundLogo";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api } from "../../services/api";

type Message = { role: "user" | "assistant"; text: string };

const AIAssistantScreen: React.FC = () => {
  const { token } = useAuth();
  const { driver, vehicle } = useLiveData();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
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
    setMessages((items) => [...items, { role: "user", text }]);
    setSending(true);
    try {
      const reply = await api.assistantMessage(token, {
        driver_id: driver.id,
        vehicle_id: vehicle.id,
        message: text,
      });
      setMessages((items) => [
        ...items,
        { role: "assistant", text: reply.answer },
      ]);
    } catch {
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          text: "I could not load the vehicle summary. Please retry.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader
        title="AI Intelligence"
        subtitle="Grounded in GPS-first vehicle data"
      />
      <ScrollView contentContainerStyle={styles.messages}>
        {messages.map((message, index) => (
          <View
            key={`${message.role}-${index}`}
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
          </View>
        ))}
        {sending && (
          <View style={[styles.bubble, styles.assistant]}>
            <ActivityIndicator color={Colors.trickeeYellow} />
          </View>
        )}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          style={styles.input}
          placeholder="Ask about your EV…"
          placeholderTextColor={Colors.secondaryText}
          onSubmitEditing={() => {
            send();
          }}
        />
        <TouchableOpacity
          style={styles.send}
          onPress={() => {
            send();
          }}
        >
          <Icon name="send" size={20} color={Colors.buttonText} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  messages: { padding: 18, gap: 12, paddingBottom: 24 },
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
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
