/**
 * EstimatedBadge — shows "Estimated" or "Live" based on data source.
 * Required by §1 rule 3-4: every prediction must be visually labeled.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors } from "../constants/Colors";

type Props = {
  source?: string;
  estimated?: boolean;
  size?: "small" | "medium";
};

const EstimatedBadge: React.FC<Props> = ({
  source,
  estimated = true,
  size = "small",
}) => {
  const isEstimated =
    estimated || source === "physics_baseline" || source === "gps_model";
  const label = isEstimated ? "Estimated" : "Live";
  const bgColor = isEstimated ? Colors.estimatedBadgeBg : Colors.liveBadgeBg;
  const textColor = isEstimated ? Colors.trickeeYellow : Colors.neonGreen;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bgColor },
        size === "medium" && styles.badgeMedium,
      ]}
    >
      {!isEstimated && (
        <View style={[styles.dot, { backgroundColor: Colors.neonGreen }]} />
      )}
      <Text
        style={[
          styles.text,
          { color: textColor },
          size === "medium" && styles.textMedium,
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  badgeMedium: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 4 },
  text: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  textMedium: { fontSize: 11 },
});

export default EstimatedBadge;
