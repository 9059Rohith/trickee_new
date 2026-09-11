import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Colors } from "../constants/Colors";
import { confirmationStageLabel, type PlanConfirmationStage } from "../services/planConfirmationState";

const stages: PlanConfirmationStage[] = ["location", "route_soc", "saving", "reminders"];

const PlanConfirmationProgress: React.FC<{ stage: PlanConfirmationStage }> = ({ stage }) => {
  const activeIndex = stages.indexOf(stage);
  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
      <View style={styles.activeRow}>
        <ActivityIndicator color={Colors.trickeeYellow} />
        <Text style={styles.active}>{confirmationStageLabel(stage)}</Text>
      </View>
      <Text style={styles.detail}>Step {activeIndex + 1} of {stages.length}. Keep this page open; your draft is saved on this phone.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "rgba(255,196,0,0.35)", borderRadius: 14, backgroundColor: "rgba(255,196,0,0.08)", padding: 13, gap: 7 },
  activeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  active: { flex: 1, color: Colors.white, fontSize: 14, fontWeight: "900" },
  detail: { color: Colors.secondaryText, fontSize: 13, lineHeight: 18 },
});

export default PlanConfirmationProgress;
