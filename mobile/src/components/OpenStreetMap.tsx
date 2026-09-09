import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { WebView } from "react-native-webview";
import { buildOpenStreetMapHtml } from "../services/openStreetMapHtml";

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  color?: string;
  icon?: "car" | "charger" | "user" | "destination";
}

export interface MapPolyline {
  id: string;
  points: Array<{ latitude: number; longitude: number }>;
  color?: string;
}

interface OpenStreetMapProps {
  initialLatitude?: number;
  initialLongitude?: number;
  initialZoom?: number;
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  pickerMode?: boolean;
  showUserLocation?: boolean;
  height?: number;
  fill?: boolean;
  borderRadius?: number;
  onMarkerPress?: (marker: MapMarker) => void;
  onCenterChange?: (coordinates: { lat: number; lng: number }) => void;
}

const OpenStreetMap: React.FC<OpenStreetMapProps> = ({
  initialLatitude = 21.1702,
  initialLongitude = 72.8311,
  initialZoom = 14,
  markers = [],
  polylines = [],
  pickerMode = false,
  height = 300,
  fill = false,
  borderRadius = 18,
  onMarkerPress,
  onCenterChange,
}) => {
  const html = useMemo(
    () =>
      buildOpenStreetMapHtml({
        latitude: initialLatitude,
        longitude: initialLongitude,
        zoom: initialZoom,
        markers,
        polylines,
        pickerMode,
      }),
    [initialLatitude, initialLongitude, initialZoom, markers, polylines, pickerMode]
  );
  return (
    <View style={[styles.map, fill ? styles.fill : { height }, { borderRadius }]}> 
      <WebView
        originWhitelist={["https://*", "about:blank"]}
        source={{ html, baseUrl: "https://localhost/" }}
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="never"
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            const marker = markers.find((item) => item.id === message.id);
            if (message.type === "marker" && marker) onMarkerPress?.(marker);
            if (
              message.type === "map-center" &&
              Number.isFinite(message.latitude) &&
              Number.isFinite(message.longitude)
            ) {
              onCenterChange?.({ lat: message.latitude, lng: message.longitude });
            }
          } catch {
            // Ignore malformed web content messages.
          }
        }}
        style={styles.webview}
      />
      {pickerMode ? <View pointerEvents="none" style={styles.centerPin}><Icon name="map-marker" size={42} color="#ffca20" /></View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  map: {
    overflow: "hidden",
    backgroundColor: "#081019",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  webview: { flex: 1, backgroundColor: "#081019" },
  fill: { flex: 1 },
  centerPin: { position: "absolute", left: "50%", top: "50%", marginLeft: -21, marginTop: -42 },
});

export default OpenStreetMap;
