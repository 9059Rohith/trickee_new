import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "../constants/Colors";
import type { DailyPlanLeg } from "../services/types";

const formatTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "Unavailable";

const DailyPlanLegCard: React.FC<{ leg: DailyPlanLeg }> = ({ leg }) => {
  const destination = leg.destination.name || leg.destination.query || "Stop";
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{leg.index + 1}. {destination}</Text>
        <Text style={[styles.badge, leg.degraded_reason ? styles.warn : styles.ok]}>
          {leg.degraded_reason ? "CHECK" : "READY"}
        </Text>
      </View>
      <Text style={styles.line}>Leave {formatTime(leg.planned_departure_at)} · arrive {formatTime(leg.estimated_arrival_at)}</Text>
      <Text style={styles.line}>
        {leg.distance_m == null ? "Distance unavailable" : `${(leg.distance_m / 1000).toFixed(1)} km`}
        {leg.duration_s == null ? "" : ` · ${Math.round(leg.duration_s / 60)} min`}
      </Text>
      <Text style={styles.soc}>
        {leg.arrival_soc_pct == null ? "Arrival SOC unavailable" : `Estimated arrival SOC ${leg.arrival_soc_pct.toFixed(1)}%`}
      </Text>
      <Text style={styles.source}>Energy: {leg.energy_source} · Route: {leg.route_source}</Text>
      {leg.degraded_reason ? <Text style={styles.reason}>{leg.degraded_reason.replace(/_/g, " ")}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.premiumCardBg, borderColor: Colors.premiumCardBorder, borderWidth: 1, borderRadius: 16, padding: 15, gap: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: Colors.white, fontSize: 16, fontWeight: "800" },
  badge: { fontSize: 10, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  ok: { color: Colors.greenAccent, backgroundColor: "rgba(51,204,128,0.12)" },
  warn: { color: Colors.trickeeYellow, backgroundColor: "rgba(255,202,32,0.12)" },
  line: { color: Colors.secondaryText, fontSize: 13 },
  soc: { color: Colors.neonCyan, fontSize: 14, fontWeight: "700" },
  source: { color: Colors.secondaryText, fontSize: 10 },
  reason: { color: Colors.trickeeYellow, fontSize: 12 },
});

export default DailyPlanLegCard;
