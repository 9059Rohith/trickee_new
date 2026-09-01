import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Easing } from "react-native";

/**
 * BatteryVisualizer — Animated 4-segment battery matching iOS `BatteryVisualizer`.
 *
 * iOS spec:
 *  - 4 segments, each 9×16, green (#39FF14) fill
 *  - Segments fill based on SOC (each represents 25%)
 *  - Active segments pulse opacity 0.6→1.0 via easeInOut loop (1s duration)
 *  - Outer border: white 0.25 opacity, 1.5px, rounded 6
 *  - Battery tip cap on the right: white 0.25, 3×8, rounded 2
 */
interface BatteryVisualizerProps {
  soc: number; // 0-100
}

const BatteryVisualizer: React.FC<BatteryVisualizerProps> = ({ soc }) => {
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const segments = [25, 50, 75, 100];
  const filledOpacity = { opacity: pulseAnim };

  return (
    <View style={styles.container}>
      <View style={styles.batteryBody}>
        <View style={styles.segmentsRow}>
          {segments.map((threshold, index) => {
            const isFilled = soc >= threshold;
            const isPartial = soc >= threshold - 25 && soc < threshold;

            return (
              <Animated.View
                key={index}
                style={[
                  styles.segment,
                  isFilled
                    ? styles.filledSegment
                    : isPartial
                    ? styles.partialSegment
                    : styles.emptySegment,
                  isFilled && filledOpacity,
                ]}
              />
            );
          })}
        </View>
      </View>
      <View style={styles.batteryTip} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  batteryBody: {
    width: 55,
    height: 26,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.25)",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  segmentsRow: {
    flexDirection: "row",
    gap: 2,
  },
  segment: {
    width: 9,
    height: 16,
    borderRadius: 2,
  },
  filledSegment: { backgroundColor: "#39FF14" },
  partialSegment: {
    backgroundColor: "rgba(57, 255, 20, 0.4)",
    opacity: 0.4,
  },
  emptySegment: { backgroundColor: "transparent", opacity: 0.15 },
  batteryTip: {
    width: 3,
    height: 8,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    borderRadius: 2,
    marginLeft: 1,
  },
});

export default BatteryVisualizer;
