import React, { useEffect, useState } from "react";
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "../constants/Colors";
import { canConfirmMapSelection } from "../services/planConfirmationState";
import OpenStreetMap from "./OpenStreetMap";

type Coordinates = { lat: number; lng: number };
type Props = { visible: boolean; initialCoordinates: Coordinates; fallbackUsed: boolean; onConfirm: (coordinates: Coordinates) => void; onClose: () => void };

const LocationPickerModal: React.FC<Props> = ({ visible, initialCoordinates, fallbackUsed, onConfirm, onClose }) => {
  const [selected, setSelected] = useState(initialCoordinates);
  const [hasMoved, setHasMoved] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setSelected(initialCoordinates);
    setHasMoved(false);
  }, [initialCoordinates, visible]);
  const confirmEnabled = canConfirmMapSelection(fallbackUsed, hasMoved);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel location selection" style={styles.headerButton} onPress={onClose}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity><Text style={styles.title}>Select stop on map</Text><View style={styles.spacer} /></View>
      <View style={styles.mapWrap}><OpenStreetMap key={`${visible}-${initialCoordinates.lat}-${initialCoordinates.lng}`} initialLatitude={initialCoordinates.lat} initialLongitude={initialCoordinates.lng} initialZoom={16} fill borderRadius={0} pickerMode onCenterChange={coordinates => { setSelected(coordinates); setHasMoved(true); }} /></View>
      <View style={styles.footer}>
        <Text style={styles.hint}>Move the map until the yellow pin is exactly over the entrance.</Text>
        {fallbackUsed ? <Text accessibilityLiveRegion="polite" style={styles.warning}>Live GPS is unavailable. The starting map position is only a preview; move the pin before confirming.</Text> : <Text style={styles.evidence}>Started from the phone's latest available location.</Text>}
        <Text style={styles.coords}>{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</Text>
        <TouchableOpacity testID="location-picker-confirm" accessibilityRole="button" accessibilityLabel="Confirm selected stop location" accessibilityState={{ disabled: !confirmEnabled }} disabled={!confirmEnabled} style={[styles.confirm, !confirmEnabled && styles.confirmDisabled]} onPress={() => onConfirm(selected)}><Text style={[styles.confirmText, !confirmEnabled && styles.confirmTextDisabled]}>{confirmEnabled ? "Confirm this location" : "Move the pin to choose a location"}</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  </Modal>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground }, header: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: Colors.premiumCardBorder },
  headerButton: { minWidth: 48, minHeight: 44, justifyContent: "center" }, cancel: { color: Colors.neonBlue, fontWeight: "800" }, title: { flex: 1, textAlign: "center", color: Colors.white, fontWeight: "900", fontSize: 17 }, spacer: { width: 48 },
  mapWrap: { flex: 1 }, footer: { padding: 16, gap: 8 }, hint: { color: Colors.white, lineHeight: 18 }, warning: { color: Colors.trickeeYellow, lineHeight: 17 }, evidence: { color: Colors.greenAccent, lineHeight: 17 }, coords: { color: Colors.greenAccent, fontWeight: "800" },
  confirm: { minHeight: 50, borderRadius: 14, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }, confirmDisabled: { backgroundColor: Colors.premiumCardBg, borderWidth: 1, borderColor: Colors.premiumCardBorder }, confirmText: { color: Colors.darkText, fontWeight: "900" }, confirmTextDisabled: { color: Colors.secondaryText },
});

export default LocationPickerModal;
