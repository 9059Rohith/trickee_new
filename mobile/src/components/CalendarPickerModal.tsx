import React, { useMemo, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import { isPastPlannerDate, monthCells, plannerMonthLabel, shiftPlannerMonth } from "../services/plannerForm";

type Props = { visible: boolean; value: string; today: string; onSelect: (iso: string) => void; onClose: () => void };
const week = ["S", "M", "T", "W", "T", "F", "S"];

const CalendarPickerModal: React.FC<Props> = ({ visible, value, today, onSelect, onClose }) => {
  const [month, setMonth] = useState(value);
  const cells = useMemo(() => monthCells(month), [month]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.card}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setMonth(shiftPlannerMonth(month, -1))}><Icon name="chevron-left" size={28} color={Colors.white} /></TouchableOpacity>
        <Text style={styles.title}>{plannerMonthLabel(month)}</Text>
        <TouchableOpacity onPress={() => setMonth(shiftPlannerMonth(month, 1))}><Icon name="chevron-right" size={28} color={Colors.white} /></TouchableOpacity>
      </View>
      <View style={styles.grid}>{week.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.grid}>{cells.map(cell => {
        const disabled = isPastPlannerDate(cell.iso, today);
        const selected = cell.iso === value;
        return <TouchableOpacity key={cell.iso} disabled={disabled} style={[styles.day, selected && styles.selected]} onPress={() => { onSelect(cell.iso); onClose(); }}>
          <Text style={[styles.dayText, !cell.inMonth && styles.outside, disabled && styles.disabled, selected && styles.selectedText]}>{cell.day}</Text>
        </TouchableOpacity>;
      })}</View>
      <TouchableOpacity style={styles.close} onPress={onClose}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
    </View></View>
  </Modal>;
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: Colors.premiumCardBg, borderColor: Colors.premiumCardBorder, borderWidth: 1, borderRadius: 20, padding: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
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
