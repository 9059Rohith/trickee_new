import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import { canShiftPlannerMonth, isPastPlannerDate, monthCells, plannerMonthLabel, shiftPlannerMonth } from "../services/plannerForm";

type Props = { visible: boolean; value: string; today: string; onSelect: (iso: string) => void; onClose: () => void };
const week = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const CalendarPickerModal: React.FC<Props> = ({ visible, value, today, onSelect, onClose }) => {
  const [month, setMonth] = useState(value);
  const cells = useMemo(() => monthCells(month), [month]);
  const previousEnabled = canShiftPlannerMonth(month, -1, today);
  useEffect(() => {
    if (visible) setMonth(value);
  }, [value, visible]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop} accessibilityViewIsModal><View style={styles.card}>
      <View style={styles.header}>
        <TouchableOpacity testID="planner-calendar-previous" accessibilityRole="button" accessibilityLabel="Previous month" accessibilityState={{ disabled: !previousEnabled }} style={styles.iconButton} disabled={!previousEnabled} onPress={() => setMonth(shiftPlannerMonth(month, -1))}><Icon name="chevron-left" size={28} color={previousEnabled ? Colors.white : Colors.secondaryText} /></TouchableOpacity>
        <Text style={styles.title}>{plannerMonthLabel(month)}</Text>
        <TouchableOpacity testID="planner-calendar-next" accessibilityRole="button" accessibilityLabel="Next month" style={styles.iconButton} onPress={() => setMonth(shiftPlannerMonth(month, 1))}><Icon name="chevron-right" size={28} color={Colors.white} /></TouchableOpacity>
      </View>
      <View style={styles.grid}>{week.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.grid}>{cells.map(cell => {
        const disabled = isPastPlannerDate(cell.iso, today);
        const selected = cell.iso === value;
        return <TouchableOpacity key={cell.iso} accessibilityRole="button" accessibilityLabel={new Date(`${cell.iso}T00:00:00Z`).toLocaleDateString("en-IN", { dateStyle: "full", timeZone: "UTC" })} accessibilityState={{ disabled, selected }} disabled={disabled} style={[styles.day, selected && styles.selected]} onPress={() => { onSelect(cell.iso); onClose(); }}>
          <Text style={[styles.dayText, !cell.inMonth && styles.outside, disabled && styles.disabled, selected && styles.selectedText]}>{cell.day}</Text>
        </TouchableOpacity>;
      })}</View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close calendar" style={styles.close} onPress={onClose}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
    </View></View>
  </Modal>;
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: Colors.premiumCardBg, borderColor: Colors.premiumCardBorder, borderWidth: 1, borderRadius: 20, padding: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  title: { color: Colors.white, fontWeight: "900", fontSize: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.285%", textAlign: "center", color: Colors.secondaryText, fontWeight: "800", paddingVertical: 8 },
  day: { width: "14.285%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  selected: { backgroundColor: Colors.trickeeYellow },
  dayText: { color: Colors.white, fontWeight: "700" },
  outside: { color: Colors.secondaryText },
  disabled: { opacity: 0.25 },
  selectedText: { color: Colors.darkText },
  close: { alignSelf: "flex-end", padding: 10, marginTop: 8 },
  closeText: { color: Colors.neonBlue, fontWeight: "800" },
});

export default CalendarPickerModal;
