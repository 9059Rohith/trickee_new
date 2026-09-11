import React from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import {
  addPlannerStop,
  ensurePlannerStopIds,
  movePlannerStop,
  removePlannerStop,
  updatePlannerStop,
  type PlannerStop,
} from "../services/plannerForm";

type Props = {
  stops: PlannerStop[];
  onChange: (stops: PlannerStop[]) => void;
  onSelectMap: (stopId: string) => void;
  onSelectTime: (stopId: string) => void;
};

const DailyPlanStopEditor: React.FC<Props> = ({ stops, onChange, onSelectMap, onSelectTime }) => {
  const emit = (next: Parameters<typeof ensurePlannerStopIds>[0]) => onChange(ensurePlannerStopIds(next));
  return <View style={styles.list}>
  {stops.map((stop, index) => <View key={stop.local_id} style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>Stop {index + 1}</Text>
      <TouchableOpacity testID={`planner-stop-${index}-up`} accessibilityRole="button" accessibilityLabel={`Move stop ${index + 1} earlier`} accessibilityState={{ disabled: index === 0 }} style={styles.iconButton} disabled={index === 0} onPress={() => emit(movePlannerStop(stops, index, -1))}><Icon name="arrow-up" size={20} color={index === 0 ? Colors.secondaryText : Colors.white} /></TouchableOpacity>
      <TouchableOpacity testID={`planner-stop-${index}-down`} accessibilityRole="button" accessibilityLabel={`Move stop ${index + 1} later`} accessibilityState={{ disabled: index === stops.length - 1 }} style={styles.iconButton} disabled={index === stops.length - 1} onPress={() => emit(movePlannerStop(stops, index, 1))}><Icon name="arrow-down" size={20} color={index === stops.length - 1 ? Colors.secondaryText : Colors.white} /></TouchableOpacity>
      <TouchableOpacity testID={`planner-stop-${index}-delete`} accessibilityRole="button" accessibilityLabel={`Remove stop ${index + 1}`} accessibilityState={{ disabled: stops.length === 1 }} style={styles.iconButton} disabled={stops.length === 1} onPress={() => emit(removePlannerStop(stops, index))}><Icon name="delete-outline" size={20} color={stops.length === 1 ? Colors.secondaryText : Colors.redSoft} /></TouchableOpacity>
    </View>
    <Text style={styles.fieldLabel}>Location name <Text style={styles.required}>Required</Text></Text>
    <TextInput testID={`planner-stop-${index}-label`} accessibilityLabel={`Location name for stop ${index + 1}`} style={styles.input} value={stop.label} onChangeText={label => emit(updatePlannerStop(stops, index, { label }))} placeholder="Example: Main office" placeholderTextColor={Colors.secondaryText} maxLength={160} />
    <Text style={styles.fieldLabel}>Arrival time <Text style={styles.required}>Required</Text></Text>
    <TouchableOpacity testID={`planner-stop-${index}-time`} accessibilityRole="button" accessibilityLabel={`Choose arrival time for stop ${index + 1}`} style={styles.timeButton} onPress={() => onSelectTime(stop.local_id)}>
      <Icon name="clock-outline" size={20} color={Colors.trickeeYellow} />
      <Text style={[styles.timeText, !stop.requested_arrival_local && styles.placeholder]}>{stop.requested_arrival_local || "Choose a time"}</Text>
      <Icon name="chevron-right" size={20} color={Colors.secondaryText} />
    </TouchableOpacity>
    <TouchableOpacity testID={`planner-stop-${index}-map`} accessibilityRole="button" accessibilityLabel={`${stop.coordinates ? "Change" : "Select"} map location for stop ${index + 1}`} style={styles.mapButton} onPress={() => onSelectMap(stop.local_id)}><Icon name="map-marker-radius" size={18} color={Colors.neonBlue} /><Text style={styles.mapText}>{stop.coordinates ? "Change pin on map" : "Select on map"}</Text></TouchableOpacity>
    {stop.resolved_location?.formatted_address ? <Text style={styles.evidence}>{stop.resolved_location.formatted_address} · {stop.resolved_location.source}</Text> : null}
    {stop.coordinates ? <Text style={styles.coords}>{stop.coordinates.lat.toFixed(5)}, {stop.coordinates.lng.toFixed(5)}</Text> : <Text style={styles.unresolved}>Location will be resolved before routing</Text>}
  </View>)}
  <TouchableOpacity testID="planner-add-stop" accessibilityRole="button" accessibilityLabel="Add another stop" accessibilityState={{ disabled: stops.length >= 10 }} style={styles.addButton} disabled={stops.length >= 10} onPress={() => emit(addPlannerStop(stops))}><Icon name="plus" size={20} color={stops.length >= 10 ? Colors.secondaryText : Colors.greenAccent} /><Text style={[styles.addText, stops.length >= 10 && styles.dim]}>Add stop ({stops.length}/10)</Text></TouchableOpacity>
</View>;
};

const styles = StyleSheet.create({
  list: { gap: 10 }, card: { backgroundColor: Colors.premiumCardBg, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 14, padding: 12, gap: 9 },
  heading: { flexDirection: "row", alignItems: "center", gap: 5 }, title: { flex: 1, color: Colors.white, fontWeight: "900" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  fieldLabel: { color: Colors.primaryText, fontSize: 14, fontWeight: "800", marginTop: 2 },
  required: { color: Colors.trickeeYellow, fontSize: 12, fontWeight: "700" },
  input: { color: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.premiumCardBorder, paddingVertical: 8 },
  timeButton: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 12, paddingHorizontal: 12 },
  timeText: { flex: 1, color: Colors.white, fontSize: 15, fontWeight: "800" },
  placeholder: { color: Colors.secondaryText, fontWeight: "600" },
  mapButton: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 5 }, mapText: { color: Colors.neonBlue, fontWeight: "800" },
  evidence: { color: Colors.secondaryText, fontSize: 11, lineHeight: 16 }, coords: { color: Colors.greenAccent, fontSize: 11 }, unresolved: { color: Colors.trickeeYellow, fontSize: 11 },
  addButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, padding: 13, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 12 }, addText: { color: Colors.greenAccent, fontWeight: "800" }, dim: { color: Colors.secondaryText },
});

export default DailyPlanStopEditor;
