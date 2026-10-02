import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLiveData } from "../context/LiveDataContext";
import { motionColors } from "../motion/tokens";
import { fontFamily } from "../theme/typography";

const AppHeader: React.FC<{ onMenu: () => void }> = ({ onMenu }) => {
  const insets = useSafeAreaInsets();
  const { alerts, me } = useLiveData();
  const unresolved = alerts.filter(item => !item.is_resolved).length;
  const active = Boolean(me?.active_trip);

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
      <View style={styles.brand}>
        <View style={styles.brandRule} />
        <Text style={styles.wordmark}>T<Text style={styles.yellow}>R</Text>ICKEE</Text>
        <Text style={styles.brandCaption}>ROUTE INTELLIGENCE</Text>
      </View>
      <View style={styles.actions}>
        <View style={styles.liveStatus} accessibilityLabel={active ? "Trip live" : "Ready"}>
          <View style={[styles.statusDot, active && styles.statusActive]} />
          <Text style={styles.statusText}>{active ? "LIVE" : "READY"}</Text>
        </View>
        <View style={styles.alerts} accessibilityLabel={`${unresolved} unresolved alerts`}>
          <Icon name="bell-outline" size={20} color="#C9D5D6" />
          {unresolved > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{Math.min(unresolved, 9)}</Text></View>}
        </View>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={onMenu}
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
        >
          <Icon name="menu" size={22} color={motionColors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: { zIndex: 20, minHeight: 78, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "rgba(72,223,244,0.18)", backgroundColor: motionColors.ink },
  brand: { flexShrink: 1 },
  brandRule: { width: 28, height: 2, backgroundColor: motionColors.yellow, marginBottom: 5 },
  wordmark: { color: motionColors.text, fontFamily: fontFamily.headingBold, fontSize: 19, letterSpacing: -1 },
  yellow: { color: motionColors.yellow },
  brandCaption: { color: "#8A9BA0", fontFamily: fontFamily.technical, fontSize: 6, letterSpacing: 0.65, marginTop: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  liveStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#85979B" },
  statusActive: { backgroundColor: "#39FF14" },
  statusText: { color: "#9BAEB1", fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 0.5 },
  alerts: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", right: 1, top: 3, minWidth: 15, height: 15, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: motionColors.coral },
  badgeText: { color: motionColors.ink, fontFamily: fontFamily.bodyBold, fontSize: 9 },
  menuButton: { width: 42, height: 42, borderWidth: 1, borderColor: "rgba(72,223,244,0.26)", borderRadius: 10, alignItems: "center", justifyContent: "center" },
});

export default AppHeader;
