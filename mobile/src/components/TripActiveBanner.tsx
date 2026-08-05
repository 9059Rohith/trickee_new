/**
 * TripActiveBanner — persistent banner during active GPS tracking (§5.3).
 * Shows elapsed time and the native durable collector/outbox state.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors } from "../constants/Colors";
import { telemetryStatus } from "../services/telemetryNative";

type Props = {
  tripStartedAt?: string;
};

const TripActiveBanner: React.FC<Props> = ({ tripStartedAt }) => {
  const [elapsed, setElapsed] = useState("00:00");
  const [pending, setPending] = useState(0);
  const [collectorActive, setCollectorActive] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (tripStartedAt) {
        const diff = Math.floor(
          (Date.now() - new Date(tripStartedAt).getTime()) / 1000
        );
        const mins = Math.floor(diff / 60);
        const secs = diff % 60;
        setElapsed(
          `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
        );
      }
      telemetryStatus()
        .then((status) => {
          setCollectorActive(status.active);
          setPending(status.pendingWindowCount);
        })
        .catch(() => setCollectorActive(false));
    }, 1000);
    return () => clearInterval(interval);
  }, [tripStartedAt]);

  if (!tripStartedAt) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <View style={styles.indicator}>
        <View style={styles.pulseDot} />
        <Text style={styles.trackingText}>
          {collectorActive ? "GPS + IMU RECORDING" : "TRIP ACTIVE"}
        </Text>
      </View>
      <Text style={styles.elapsed}>{elapsed}</Text>
      <Text style={styles.points}>{pending} queued</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(57, 255, 20, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(57, 255, 20, 0.20)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 12,
  },
  indicator: { flexDirection: "row", alignItems: "center", flex: 1, gap: 6 },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.neonGreen,
  },
  trackingText: {
    color: Colors.neonGreen,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  elapsed: {
    color: Colors.primaryText,
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  points: { color: Colors.secondaryText, fontSize: 11, fontWeight: "600" },
});

export default TripActiveBanner;
