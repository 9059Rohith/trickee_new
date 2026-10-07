import React, { useEffect, useState } from "react";
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "../constants/Colors";
import { canConfirmMapSelection } from "../services/planConfirmationState";
import OpenStreetMap from "./OpenStreetMap";
import { fontFamily } from "../theme/typography";

type Coordinates = { lat: number; lng: number };
type Props = {
  visible: boolean;
  initialCoordinates: Coordinates;
  initialSource?: "device_location" | "search_result";
  fallbackUsed: boolean;
  onConfirm: (coordinates: Coordinates, adjusted: boolean) => void;
  onClose: () => void;
};

const LocationPickerModal: React.FC<Props> = ({ visible, initialCoordinates, initialSource = "device_location", fallbackUsed, onConfirm, onClose }) => {
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
      <View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel location selection" style={styles.headerButton} onPress={onClose}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity><View style={styles.titleBlock}><Text style={styles.eyebrow}>DESTINATION PIN</Text><Text style={styles.title}>Select stop on map</Text></View><View style={styles.spacer} /></View>
      <View style={styles.mapWrap}><OpenStreetMap key={`${visible}-${initialCoordinates.lat}-${initialCoordinates.lng}`} initialLatitude={initialCoordinates.lat} initialLongitude={initialCoordinates.lng} initialZoom={16} fill borderRadius={0} pickerMode onCenterChange={coordinates => { setSelected(coordinates); setHasMoved(true); }} /></View>
      <View style={styles.footer}>
        <Text style={styles.hint}>Move the map until the yellow pin is exactly over the entrance.</Text>
        {fallbackUsed ? <Text accessibilityLiveRegion="polite" style={styles.warning}>Live GPS is unavailable. The starting map position is only a preview; move the pin before confirming.</Text> : <Text style={styles.evidence}>{initialSource === "search_result" ? "Map centered on the matched address. Confirm it or move the pin." : "Started from the phone's latest available location."}</Text>}
        <Text style={styles.coords}>{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</Text>
        <TouchableOpacity testID="location-picker-confirm" accessibilityRole="button" accessibilityLabel="Confirm selected stop location" accessibilityState={{ disabled: !confirmEnabled }} disabled={!confirmEnabled} style={[styles.confirm, !confirmEnabled && styles.confirmDisabled]} onPress={() => onConfirm(selected, hasMoved)}><Text style={[styles.confirmText, !confirmEnabled && styles.confirmTextDisabled]}>{confirmEnabled ? "Confirm this location" : "Move the pin to choose a location"}</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  </Modal>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground }, header: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: Colors.premiumCardBorder },
  headerButton: { minWidth: 48, minHeight: 44, justifyContent: "center" }, cancel: { color: Colors.motionCyan, fontFamily: fontFamily.bodyHeavy }, titleBlock: { flex: 1, alignItems: "center" }, eyebrow: { color: Colors.motionCyan, fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 1.2 }, title: { textAlign: "center", color: Colors.white, fontFamily: fontFamily.heading, fontSize: 17 }, spacer: { width: 48 },
  mapWrap: { flex: 1 }, footer: { padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: Colors.liquidGlassBorder }, hint: { color: Colors.white, lineHeight: 18, fontFamily: fontFamily.bodyMedium }, warning: { color: Colors.trickeeYellow, lineHeight: 17, fontFamily: fontFamily.body }, evidence: { color: Colors.greenAccent, lineHeight: 17, fontFamily: fontFamily.body }, coords: { color: Colors.greenAccent, fontFamily: fontFamily.technical, fontSize: 11 },
  confirm: { minHeight: 50, borderRadius: 14, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }, confirmDisabled: { backgroundColor: Colors.premiumCardBg, borderWidth: 1, borderColor: Colors.premiumCardBorder }, confirmText: { color: Colors.darkText, fontFamily: fontFamily.bodyHeavy }, confirmTextDisabled: { color: Colors.secondaryText },
});

export default LocationPickerModal;
