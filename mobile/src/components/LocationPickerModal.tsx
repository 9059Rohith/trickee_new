import React, { useEffect, useState } from "react";
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "../constants/Colors";
import OpenStreetMap from "./OpenStreetMap";

type Coordinates = { lat: number; lng: number };
type Props = { visible: boolean; initialCoordinates: Coordinates; fallbackUsed: boolean; onConfirm: (coordinates: Coordinates) => void; onClose: () => void };

const LocationPickerModal: React.FC<Props> = ({ visible, initialCoordinates, fallbackUsed, onConfirm, onClose }) => {
  const [selected, setSelected] = useState(initialCoordinates);
  useEffect(() => setSelected(initialCoordinates), [initialCoordinates]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onClose}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity><Text style={styles.title}>Select stop on map</Text><View style={styles.spacer} /></View>
      <View style={styles.mapWrap}><OpenStreetMap initialLatitude={initialCoordinates.lat} initialLongitude={initialCoordinates.lng} initialZoom={16} fill borderRadius={0} pickerMode onCenterChange={setSelected} /></View>
      <View style={styles.footer}>
        <Text style={styles.hint}>Move the map until the yellow pin is exactly over the entrance.</Text>
        {fallbackUsed ? <Text style={styles.warning}>Live GPS unavailable. Map started at the Surat fallback; move the pin before confirming.</Text> : null}
        <Text style={styles.coords}>{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</Text>
        <TouchableOpacity style={styles.confirm} onPress={() => onConfirm(selected)}><Text style={styles.confirmText}>Confirm this location</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  </Modal>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground }, header: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: Colors.premiumCardBorder },
  cancel: { color: Colors.neonBlue, fontWeight: "800" }, title: { flex: 1, textAlign: "center", color: Colors.white, fontWeight: "900", fontSize: 17 }, spacer: { width: 48 },
  mapWrap: { flex: 1 }, footer: { padding: 16, gap: 8 }, hint: { color: Colors.white, lineHeight: 18 }, warning: { color: Colors.trickeeYellow, lineHeight: 17 }, coords: { color: Colors.greenAccent, fontWeight: "800" },
  confirm: { minHeight: 50, borderRadius: 14, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center" }, confirmText: { color: Colors.darkText, fontWeight: "900" },
});

export default LocationPickerModal;
