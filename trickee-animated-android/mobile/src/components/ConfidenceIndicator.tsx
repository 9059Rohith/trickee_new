/**
 * ConfidenceIndicator — 3-bar visual showing low/medium/high confidence.
 * Used on Vehicle Detail and Trip screens per §3.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors } from "../constants/Colors";

type Props = {
  confidence?: string | null; // low / medium / high
  confidenceNumeric?: number | null; // 0-1
  showLabel?: boolean;
};

const ConfidenceIndicator: React.FC<Props> = ({
  confidence,
  confidenceNumeric,
  showLabel = true,
}) => {
  const level =
    confidence === "high" || (confidenceNumeric && confidenceNumeric >= 0.7)
      ? 3
      : confidence === "medium" ||
        (confidenceNumeric && confidenceNumeric >= 0.4)
      ? 2
      : 1;

  const barColors = [
    level >= 1
      ? level === 1
        ? Colors.confidenceLow
        : level === 2
        ? Colors.confidenceMedium
        : Colors.confidenceHigh
      : Colors.borderSubtle,
    level >= 2
      ? level === 2
        ? Colors.confidenceMedium
        : Colors.confidenceHigh
      : Colors.borderSubtle,
    level >= 3 ? Colors.confidenceHigh : Colors.borderSubtle,
  ];

  const label = level === 3 ? "High" : level === 2 ? "Medium" : "Low";

  return (
    <View style={styles.container}>
      <View style={styles.bars}>
        {barColors.map((color, i) => (
          <View
            key={i}
            style={[styles.bar, { backgroundColor: color, height: 6 + i * 3 }]}
          />
        ))}
      </View>
      {showLabel && (
        <Text style={[styles.label, { color: barColors[level - 1] }]}>
          {label}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  bar: { width: 4, borderRadius: 1 },
  label: {
    fontSize: 9,
    fontWeight: "600",
    marginLeft: 2,
    textTransform: "uppercase",
  },
});

export default ConfidenceIndicator;
