import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";
import { useAuth } from "../context/AuthContext";
import { useLiveData } from "../context/LiveDataContext";

const ITEMS = [
  ["Plan My Day", "calendar-clock", "DailyPlanner"],
  ["Route Updates", "bell-outline", "RouteNudges"],
  ["Vehicle Details", "motorbike-electric", "VehicleOnboarding"],
] as const;

const SideDrawer: React.FC<{
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string, params?: Record<string, unknown>) => void;
}> = ({ visible, onClose, onNavigate }) => {
  const x = useRef(new Animated.Value(-330)).current;
  const { logout, user } = useAuth();
  const { vehicle } = useLiveData();
  useEffect(() => {
    Animated.spring(x, {
      toValue: visible ? 0 : -330,
      damping: 22,
      stiffness: 220,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [visible, x]);

  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.drawer, { transform: [{ translateX: x }] }]}
        >
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Icon name="account" size={28} color={Colors.buttonText} />
            </View>
            <View style={styles.profileText}>
              <Text style={styles.name}>
                {user?.full_name || "Trickee Driver"}
              </Text>
              <Text style={styles.vehicle}>
                {vehicle?.vehicle_code || "No vehicle"}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close navigation menu"
              style={styles.closeButton}
              onPress={onClose}
            >
              <Icon name="close" size={24} color={Colors.white} />
            </TouchableOpacity>
          </View>
          <Text style={styles.section}>NAVIGATION</Text>
          {ITEMS.map(([label, icon, route]) => (
            <TouchableOpacity
              key={route}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={styles.item}
              onPress={() => {
                onClose();
                onNavigate(route, route === "VehicleOnboarding" ? { vehicle } : undefined);
              }}
            >
              <Icon name={icon} size={21} color={Colors.trickeeYellow} />
              <Text style={styles.label}>{label}</Text>
              <Icon
                name="chevron-right"
                size={18}
                color={Colors.secondaryText}
              />
            </TouchableOpacity>
          ))}
          <View style={styles.spacer} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Log out"
            style={styles.logout}
            onPress={() => {
              onClose();
              logout();
            }}
          >
            <Icon name="logout" size={21} color={Colors.red} />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)" },
  drawer: {
    width: "84%",
    maxWidth: 330,
    height: "100%",
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 30,
    backgroundColor: "#09111F",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,202,32,0.25)",
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 28,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.trickeeYellow,
  },
  profileText: { flex: 1 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  name: { color: Colors.white, fontSize: 16, fontWeight: "800" },
  vehicle: { color: Colors.secondaryText, fontSize: 12, marginTop: 2 },
  section: {
    color: Colors.secondaryText,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 9,
  },
  item: {
    height: 50,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 5,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  label: { flex: 1, color: Colors.white, fontSize: 14, fontWeight: "600" },
  spacer: { flex: 1 },
  logout: {
    height: 48,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(255,68,68,0.08)",
  },
  logoutText: { color: Colors.red, fontWeight: "800" },
});

export default SideDrawer;
