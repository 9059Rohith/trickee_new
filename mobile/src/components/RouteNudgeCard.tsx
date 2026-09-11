import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import { nudgeActionState } from "../services/mapNavigation";
import type { RouteNudge, RouteNudgeEvent } from "../services/types";
import { nudgeAcceptanceLabel } from "../services/presentation";

const formatLeaveTime = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const RouteNudgeCard: React.FC<{
  nudge: RouteNudge;
  onAction: (event: RouteNudgeEvent) => void;
  busy?: boolean;
}> = ({ nudge, onAction, busy = false }) => {
  const leaveTime = formatLeaveTime(nudge.payload.leave_at);
  const liveTraffic =
    nudge.payload.provider_source === "google_routes" &&
    !nudge.payload.degraded_reason;
  const actionState = nudgeActionState(nudge.outcome?.latest_event);
  const mapAvailable =
    typeof nudge.payload.destination_lat === "number" &&
    typeof nudge.payload.destination_lng === "number";
  return (
    <View style={styles.card} accessibilityLabel="Route recommendation">
      <View style={styles.headerRow}>
        <Icon name="routes" size={20} color={Colors.trickeeYellow} />
        <Text style={styles.eyebrow}>ROUTE UPDATE</Text>
      </View>
      <Text style={styles.title}>{nudge.title}</Text>
      <Text style={styles.body}>{nudge.body}</Text>
      {nudge.payload.route_name ? (
        <Text style={styles.fact}>Route · {nudge.payload.route_name}</Text>
      ) : null}
      {leaveTime ? <Text style={styles.fact}>Leave · {leaveTime}</Text> : null}
      {typeof nudge.payload.arrival_soc_pct === "number" ? (
        <Text style={styles.fact}>
          Expected arrival SOC · {Math.round(nudge.payload.arrival_soc_pct)}%
        </Text>
      ) : null}
      <Text style={liveTraffic ? styles.evidence : styles.warning}>
        {liveTraffic
          ? "Google live traffic used for this route"
          : `Live traffic unavailable${nudge.payload.degraded_reason ? ` · ${nudge.payload.degraded_reason.replace(/_/g, " ")}` : ""}`}
      </Text>
      {nudge.payload.place_confirmed === true &&
      nudge.payload.availability_confirmed !== true ? (
        <Text style={styles.warning}>Charger exists; live slot availability is not confirmed</Text>
      ) : null}
      <View style={styles.actions}>
        {actionState.label ? (
          <View style={actionState.terminal ? styles.terminalBadge : styles.infoBadge}>
            <Text style={actionState.terminal ? styles.terminalText : styles.infoText}>
              {actionState.label}
            </Text>
          </View>
        ) : null}
        {!actionState.terminal ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Mark this route recommendation as accepted"
            accessibilityHint="Records your choice but does not start navigation"
            style={styles.primaryButton}
            disabled={busy}
            onPress={() => onAction("accepted")}
          >
            <Text style={styles.primaryText}>{busy ? "Saving…" : nudgeAcceptanceLabel(false)}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={mapAvailable ? "Open route in Google Maps" : "Route map unavailable"}
          style={[styles.secondaryButton, !mapAvailable && styles.disabledButton]}
          disabled={busy || !mapAvailable}
          onPress={() => onAction("opened")}
        >
          <Text style={styles.secondaryText}>
            {mapAvailable ? "Open navigation" : "Map unavailable"}
          </Text>
        </TouchableOpacity>
        {!actionState.terminal ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Dismiss this route recommendation"
            style={styles.textButton}
            disabled={busy}
            onPress={() => onAction("dismissed")}
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(9,17,31,0.96)",
    borderColor: "rgba(255,202,32,0.35)",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: {
    color: Colors.trickeeYellow,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  title: { color: Colors.white, fontSize: 17, fontWeight: "800", marginTop: 10 },
  body: { color: Colors.secondaryText, fontSize: 13, lineHeight: 19, marginTop: 6 },
  fact: { color: Colors.white, fontSize: 13, fontWeight: "600", marginTop: 8 },
  evidence: { color: Colors.neonGreen, fontSize: 12, marginTop: 10 },
  warning: { color: Colors.trickeeYellow, fontSize: 12, lineHeight: 17, marginTop: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  primaryButton: {
    backgroundColor: Colors.trickeeYellow,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  primaryText: { color: Colors.buttonText, fontWeight: "800" },
  secondaryButton: {
    borderColor: "rgba(255,255,255,0.24)",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryText: { color: Colors.white, fontWeight: "700" },
  textButton: { minHeight: 44, paddingHorizontal: 9, paddingVertical: 10, justifyContent: "center" },
  dismissText: { color: Colors.secondaryText, fontWeight: "700" },
  disabledButton: { opacity: 0.45 },
  terminalBadge: {
    borderRadius: 10,
    backgroundColor: "rgba(57,255,20,0.12)",
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  terminalText: { color: Colors.neonGreen, fontWeight: "800" },
  infoBadge: {
    borderRadius: 10,
    backgroundColor: "rgba(0,229,255,0.1)",
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  infoText: { color: Colors.neonBlue, fontWeight: "800" },
});

export default RouteNudgeCard;
