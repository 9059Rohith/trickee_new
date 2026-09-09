import React from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import type { DailyPlanStop } from "../services/types";
import { addPlannerStop, movePlannerStop, removePlannerStop, updatePlannerStop } from "../services/plannerForm";

type Props = { stops: DailyPlanStop[]; onChange: (stops: DailyPlanStop[]) => void; onSelectMap: (index: number) => void };

const DailyPlanStopEditor: React.FC<Props> = ({ stops, onChange, onSelectMap }) => <View style={styles.list}>
  {stops.map((stop, index) => <View key={`stop-${index}`} style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>Stop {index + 1}</Text>
      <TouchableOpacity disabled={index === 0} onPress={() => onChange(movePlannerStop(stops, index, -1))}><Icon name="arrow-up" size={20} color={index === 0 ? Colors.secondaryText : Colors.white} /></TouchableOpacity>
      <TouchableOpacity disabled={index === stops.length - 1} onPress={() => onChange(movePlannerStop(stops, index, 1))}><Icon name="arrow-down" size={20} color={index === stops.length - 1 ? Colors.secondaryText : Colors.white} /></TouchableOpacity>
      <TouchableOpacity disabled={stops.length === 1} onPress={() => onChange(removePlannerStop(stops, index))}><Icon name="delete-outline" size={20} color={stops.length === 1 ? Colors.secondaryText : Colors.redSoft} /></TouchableOpacity>
    </View>
    <TextInput style={styles.input} value={stop.label} onChangeText={label => onChange(updatePlannerStop(stops, index, { label }))} placeholder="Location name" placeholderTextColor={Colors.secondaryText} maxLength={160} />
    <TextInput style={styles.input} value={stop.requested_arrival_local || ""} onChangeText={requested_arrival_local => onChange(updatePlannerStop(stops, index, { requested_arrival_local }))} placeholder="Arrival time (HH:MM)" placeholderTextColor={Colors.secondaryText} keyboardType="numbers-and-punctuation" maxLength={5} />
    <TouchableOpacity style={styles.mapButton} onPress={() => onSelectMap(index)}><Icon name="map-marker-radius" size={18} color={Colors.neonBlue} /><Text style={styles.mapText}>{stop.coordinates ? "Change pin on map" : "Select on map"}</Text></TouchableOpacity>
    {stop.resolved_location?.formatted_address ? <Text style={styles.evidence}>{stop.resolved_location.formatted_address} · {stop.resolved_location.source}</Text> : null}
    {stop.coordinates ? <Text style={styles.coords}>{stop.coordinates.lat.toFixed(5)}, {stop.coordinates.lng.toFixed(5)}</Text> : <Text style={styles.unresolved}>Location will be resolved before routing</Text>}
  </View>)}
  <TouchableOpacity style={styles.addButton} disabled={stops.length >= 10} onPress={() => onChange(addPlannerStop(stops))}><Icon name="plus" size={20} color={stops.length >= 10 ? Colors.secondaryText : Colors.greenAccent} /><Text style={[styles.addText, stops.length >= 10 && styles.dim]}>Add stop ({stops.length}/10)</Text></TouchableOpacity>
</View>;

const styles = StyleSheet.create({
  list: { gap: 10 }, card: { backgroundColor: Colors.premiumCardBg, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 14, padding: 12, gap: 9 },
  heading: { flexDirection: "row", alignItems: "center", gap: 14 }, title: { flex: 1, color: Colors.white, fontWeight: "900" },
  input: { color: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.premiumCardBorder, paddingVertical: 8 },
  mapButton: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 5 }, mapText: { color: Colors.neonBlue, fontWeight: "800" },
  evidence: { color: Colors.secondaryText, fontSize: 11, lineHeight: 16 }, coords: { color: Colors.greenAccent, fontSize: 11 }, unresolved: { color: Colors.trickeeYellow, fontSize: 11 },
  addButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, padding: 13, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 12 }, addText: { color: Colors.greenAccent, fontWeight: "800" }, dim: { color: Colors.secondaryText },
});

export default DailyPlanStopEditor;
