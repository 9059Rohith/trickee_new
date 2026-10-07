import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "../constants/Colors";
import type { NextDailyPlanLeg } from "../services/types";
import { fontFamily } from "../theme/typography";

const timeLabel = (value: string | null) => {
  if (!value) return "Time not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not available" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const NextTripCard: React.FC<{ leg: NextDailyPlanLeg; onStart: () => void }> = ({ leg, onStart }) => (
  <View testID="animated-next-trip-card" style={styles.card}>
    <View style={styles.copy}>
      <Text style={styles.eyebrow}>NEXT PLANNED STOP</Text>
      <Text style={styles.title}>{leg.destination_text}</Text>
      <Text style={styles.meta}>Depart {timeLabel(leg.planned_departure_at)} · {leg.status}</Text>
    </View>
    <TouchableOpacity testID="next-trip-start" style={styles.button} onPress={onStart}>
      <Text style={styles.buttonText}>Review & start</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  card: { marginBottom: 12, padding: 15, borderRadius: 18, borderWidth: 1, borderColor: "rgba(72,223,244,0.32)", backgroundColor: "rgba(72,223,244,0.07)", flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, gap: 3 },
  eyebrow: { color: Colors.motionCyan, fontFamily: fontFamily.technical, fontSize: 9, letterSpacing: 1 },
  title: { color: Colors.white, fontFamily: fontFamily.heading, fontSize: 16 },
  meta: { color: Colors.secondaryText, fontFamily: fontFamily.body, fontSize: 12 },
  button: { minHeight: 42, borderRadius: 12, backgroundColor: Colors.motionCyan, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  buttonText: { color: Colors.darkText, fontFamily: fontFamily.bodyHeavy, fontSize: 12 },
});

export default NextTripCard;
