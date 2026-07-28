import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";

interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  color?: string;
  icon?: "car" | "charger" | "user" | "destination";
}

interface OpenStreetMapProps {
  initialLatitude?: number;
  initialLongitude?: number;
  initialZoom?: number;
  markers?: MapMarker[];
  showUserLocation?: boolean;
  height?: number;
  borderRadius?: number;
  onMarkerPress?: (marker: MapMarker) => void;
}

const ICONS: Record<string, string> = {
  car: "car",
  charger: "ev-station",
  user: "crosshairs-gps",
  destination: "map-marker",
};

const OpenStreetMap: React.FC<OpenStreetMapProps> = ({
  initialLatitude = 21.1702,
  initialLongitude = 72.8311,
  markers = [],
  height = 300,
  borderRadius = 18,
  onMarkerPress,
}) => (
  <View style={[styles.map, { height, borderRadius }]}>
    <View style={styles.roadHorizontal} />
    <View style={styles.roadVertical} />
    <View style={styles.roadDiagonal} />
    <Text style={styles.areaLabel}>LIVE GPS MAP</Text>
    <Text style={styles.coordinates}>
      {initialLatitude.toFixed(4)}, {initialLongitude.toFixed(4)}
    </Text>
    {markers.map((marker, index) => (
      <TouchableOpacity
        key={marker.id}
        activeOpacity={0.8}
        onPress={() => onMarkerPress?.(marker)}
        style={[
          styles.marker,
          {
            left: `${28 + ((index * 23) % 52)}%`,
            top: `${34 + ((index * 17) % 34)}%`,
            backgroundColor: marker.color || Colors.trickeeYellow,
          },
        ]}
      >
        <Icon
          name={ICONS[marker.icon || "car"]}
          size={20}
          color={Colors.buttonText}
        />
      </TouchableOpacity>
    ))}
    <View style={styles.controls}>
      <Icon name="plus" size={22} color={Colors.trickeeYellow} />
      <View style={styles.divider} />
      <Icon name="minus" size={22} color={Colors.trickeeYellow} />
    </View>
    <View style={styles.provider}>
      <Icon name="shield-check" size={12} color={Colors.trickeeYellow} />
      <Text style={styles.providerText}>Foreground GPS</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  map: {
    overflow: "hidden",
    backgroundColor: "#081019",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  roadHorizontal: {
    position: "absolute",
    left: -20,
    right: -20,
    top: "58%",
    height: 22,
    backgroundColor: "#17212d",
    transform: [{ rotate: "-5deg" }],
  },
  roadVertical: {
    position: "absolute",
    top: -40,
    bottom: -40,
    left: "56%",
    width: 18,
    backgroundColor: "#17212d",
    transform: [{ rotate: "11deg" }],
  },
  roadDiagonal: {
    position: "absolute",
    left: -100,
    right: -100,
    top: "28%",
    height: 10,
    backgroundColor: "#111b26",
    transform: [{ rotate: "24deg" }],
  },
  areaLabel: {
    position: "absolute",
    right: 18,
    top: 18,
    color: "rgba(255,255,255,0.18)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  coordinates: {
    position: "absolute",
    right: 16,
    bottom: 15,
    color: "rgba(255,255,255,0.35)",
    fontSize: 10,
  },
  marker: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: "rgba(255,202,32,0.2)",
    elevation: 8,
  },
  controls: {
    position: "absolute",
    left: 14,
    top: 14,
    width: 42,
    borderRadius: 10,
    backgroundColor: "rgba(4,6,10,0.9)",
    alignItems: "center",
    paddingVertical: 8,
    gap: 7,
  },
  divider: {
    height: 1,
    width: 26,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  provider: {
    position: "absolute",
    left: 14,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(4,6,10,0.78)",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  providerText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 9,
    fontWeight: "700",
  },
});

export default OpenStreetMap;
