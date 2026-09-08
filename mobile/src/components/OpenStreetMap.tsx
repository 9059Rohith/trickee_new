import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { buildOpenStreetMapHtml } from "../services/openStreetMapHtml";

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

const OpenStreetMap: React.FC<OpenStreetMapProps> = ({
  initialLatitude = 21.1702,
  initialLongitude = 72.8311,
  initialZoom = 14,
  markers = [],
  height = 300,
  borderRadius = 18,
  onMarkerPress,
}) => {
  const html = useMemo(
    () =>
      buildOpenStreetMapHtml({
        latitude: initialLatitude,
        longitude: initialLongitude,
        zoom: initialZoom,
        markers,
      }),
    [initialLatitude, initialLongitude, initialZoom, markers]
  );
  return (
    <View style={[styles.map, { height, borderRadius }]}>
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
          } catch {
            // Ignore malformed web content messages.
          }
        }}
        style={styles.webview}
      />
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
});

export default OpenStreetMap;
