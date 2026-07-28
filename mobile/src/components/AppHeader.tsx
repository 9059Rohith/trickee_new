import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/Colors";
import { useLiveData } from "../context/LiveDataContext";

const AppHeader: React.FC<{ onMenu: () => void }> = ({ onMenu }) => {
  const insets = useSafeAreaInsets();
  const { alerts, me } = useLiveData();
  const unresolved = alerts.filter((item) => !item.is_resolved).length;
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <TouchableOpacity
        style={styles.button}
        onPress={onMenu}
        accessibilityLabel="Open navigation menu"
      >
        <Icon name="menu" size={25} color={Colors.white} />
      </TouchableOpacity>
      <View style={styles.brand}>
        <Text style={styles.title}>TRICKEE</Text>
        <Text style={styles.subtitle}>GPS-FIRST EV INTELLIGENCE</Text>
      </View>
      <View style={styles.button}>
        <Icon name="bell-outline" size={23} color={Colors.white} />
        {unresolved > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{Math.min(unresolved, 9)}</Text>
          </View>
        )}
        <View
          style={[
            styles.status,
            {
              backgroundColor: me?.active_trip
                ? Colors.neonGreen
                : Colors.secondaryText,
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    zIndex: 20,
    elevation: 10,
    minHeight: 82,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#04060A",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  brand: { flex: 1, alignItems: "center" },
  title: {
    color: Colors.trickeeYellow,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  subtitle: {
    color: Colors.secondaryText,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  badge: {
    position: "absolute",
    right: 4,
    top: 3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.red,
  },
  badgeText: { color: Colors.white, fontSize: 9, fontWeight: "900" },
  status: {
    position: "absolute",
    right: 3,
    bottom: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default AppHeader;
