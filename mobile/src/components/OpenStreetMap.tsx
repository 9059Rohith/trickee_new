import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { WebView } from "react-native-webview";
import { buildOpenStreetMapHtml, buildOpenStreetMapUpdateScript } from "../services/openStreetMapHtml";

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
  fitBoundsOnUpdate?: boolean;
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
  fitBoundsOnUpdate = false,
}) => {
  const webView = useRef<WebView>(null);
  const webReady = useRef(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "online" | "degraded">("loading");
  const initialHtml = useRef<string | null>(null);
  if (!initialHtml.current) {
    initialHtml.current = buildOpenStreetMapHtml({
      latitude: initialLatitude,
      longitude: initialLongitude,
      zoom: initialZoom,
      markers: [],
      polylines: [],
      pickerMode,
    });
  }
  const source = useMemo(() => ({ html: initialHtml.current!, baseUrl: "file:///android_asset/" }), []);
  const updateScript = useMemo(
    () => buildOpenStreetMapUpdateScript({ markers, polylines, fitBounds: fitBoundsOnUpdate }),
    [fitBoundsOnUpdate, markers, polylines]
  );

  useEffect(() => {
    if (webReady.current) webView.current?.injectJavaScript(updateScript);
  }, [updateScript]);

  return (
    <View style={[styles.map, fill ? styles.fill : { height }, { borderRadius }]}>
      <WebView
        ref={webView}
        originWhitelist={["file://*", "https://*", "about:blank"]}
        source={source}
        javaScriptEnabled
        allowFileAccess
        domStorageEnabled={false}
        mixedContentMode="never"
        onLoadEnd={() => {
          webReady.current = true;
          webView.current?.injectJavaScript(buildOpenStreetMapUpdateScript({ markers, polylines, fitBounds: true }));
        }}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            const marker = markers.find((item) => item.id === message.id);
            if (message.type === "marker" && marker) onMarkerPress?.(marker);
            if (message.type === "tile-status" && (message.status === "online" || message.status === "degraded")) {
              setMapStatus(message.status);
            }
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
        onError={() => {
          webReady.current = false;
          setMapStatus("degraded");
        }}
        style={styles.webview}
      />
      {mapStatus === "degraded" ? (
        <View accessibilityLiveRegion="polite" style={styles.statusBanner}>
          <Text style={styles.statusText}>Map tiles unavailable. Recorded route and markers remain visible.</Text>
        </View>
      ) : null}
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
  statusBanner: { position: "absolute", left: 10, right: 10, top: 10, borderRadius: 10, backgroundColor: "rgba(8,16,25,0.94)", paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: "rgba(255,202,32,0.5)" },
  statusText: { color: "#ffca20", fontSize: 13, fontWeight: "700", textAlign: "center" },
});

export default OpenStreetMap;
