import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "../constants/Colors";
import { plannerTimeParts, toPlannerTime, type PlannerTimeParts } from "../services/plannerForm";

type Props = {
  visible: boolean;
  stopId: string | null;
  stopLabel: string;
  value: string | null;
  onClose: () => void;
  onSelect: (stopId: string, value: string) => void;
};

const hours = Array.from({ length: 12 }, (_, index) => index + 1);
const minutes = Array.from({ length: 12 }, (_, index) => index * 5);

const StopTimePickerModal: React.FC<Props> = ({
  visible,
  stopId,
  stopLabel,
  value,
  onClose,
  onSelect,
}) => {
  const [parts, setParts] = useState<PlannerTimeParts>(() => plannerTimeParts(value));

  useEffect(() => {
    if (visible) setParts(plannerTimeParts(value));
  }, [value, visible]);

  const choose = <K extends keyof PlannerTimeParts>(key: K, next: PlannerTimeParts[K]) =>
    setParts(current => ({ ...current, [key]: next }));

  const confirm = () => {
    if (!stopId) return;
    onSelect(stopId, toPlannerTime(parts));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>ARRIVAL TIME</Text>
          <Text style={styles.title}>{stopLabel || "Selected stop"}</Text>
          <Text style={styles.preview} accessibilityLiveRegion="polite">
            {parts.hour}:{String(parts.minute).padStart(2, "0")} {parts.period}
          </Text>

          <Text style={styles.label}>Hour</Text>
          <View style={styles.grid}>
            {hours.map(hour => (
              <TouchableOpacity
                key={hour}
                testID={`planner-time-hour-${hour}`}
                accessibilityRole="button"
                accessibilityLabel={`${hour} o'clock`}
                accessibilityState={{ selected: parts.hour === hour }}
                style={[styles.option, parts.hour === hour && styles.selected]}
                onPress={() => choose("hour", hour)}
              >
                <Text style={[styles.optionText, parts.hour === hour && styles.selectedText]}>{hour}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Minute</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.minuteRow}>
            {minutes.map(minute => (
              <TouchableOpacity
                key={minute}
                testID={`planner-time-minute-${minute}`}
                accessibilityRole="button"
                accessibilityLabel={`${minute} minutes`}
                accessibilityState={{ selected: parts.minute === minute }}
                style={[styles.minute, parts.minute === minute && styles.selected]}
                onPress={() => choose("minute", minute)}
              >
                <Text style={[styles.optionText, parts.minute === minute && styles.selectedText]}>
                  {String(minute).padStart(2, "0")}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Period</Text>
          <View style={styles.periodRow}>
            {(["AM", "PM"] as const).map(period => (
              <TouchableOpacity
                key={period}
                testID={`planner-time-period-${period.toLowerCase()}`}
                accessibilityRole="button"
                accessibilityState={{ selected: parts.period === period }}
                style={[styles.period, parts.period === period && styles.selected]}
                onPress={() => choose("period", period)}
              >
                <Text style={[styles.optionText, parts.period === period && styles.selectedText]}>{period}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              testID="planner-time-cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel arrival time selection"
              style={styles.cancel}
              onPress={onClose}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="planner-time-confirm"
              accessibilityRole="button"
              accessibilityLabel={`Set arrival time for ${stopLabel || "selected stop"}`}
              style={styles.confirm}
              onPress={confirm}
            >
              <Text style={styles.confirmText}>Set arrival time</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", justifyContent: "center", padding: 18 },
  card: { backgroundColor: Colors.premiumCardBg, borderColor: Colors.premiumCardBorder, borderWidth: 1, borderRadius: 20, padding: 18 },
  eyebrow: { color: Colors.neonBlue, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: Colors.white, fontSize: 20, fontWeight: "900", marginTop: 4 },
  preview: { color: Colors.trickeeYellow, fontSize: 34, fontWeight: "900", marginVertical: 18, textAlign: "center" },
  label: { color: Colors.primaryText, fontSize: 14, fontWeight: "800", marginTop: 10, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  option: { width: "14.9%", minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: Colors.premiumCardBorder, alignItems: "center", justifyContent: "center" },
  optionText: { color: Colors.primaryText, fontSize: 15, fontWeight: "800" },
  selected: { backgroundColor: Colors.trickeeYellow, borderColor: Colors.trickeeYellow },
  selectedText: { color: Colors.darkText },
  minuteRow: { gap: 7, paddingBottom: 2 },
  minute: { minWidth: 48, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: Colors.premiumCardBorder, alignItems: "center", justifyContent: "center" },
  periodRow: { flexDirection: "row", gap: 10 },
  period: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.premiumCardBorder, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 22 },
  cancel: { minHeight: 48, paddingHorizontal: 18, borderRadius: 13, borderWidth: 1, borderColor: Colors.premiumCardBorder, alignItems: "center", justifyContent: "center" },
  cancelText: { color: Colors.primaryText, fontWeight: "800" },
  confirm: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: Colors.greenAccent, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  confirmText: { color: Colors.darkText, fontWeight: "900" },
});

export default StopTimePickerModal;
