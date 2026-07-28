/**
 * SettingsScreen — profile, logout, version info.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Colors } from "../../constants/Colors";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import GlassCard from "../../components/GlassCard";

const SettingsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const { vehicle } = useLiveData();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <GlassCard style={styles.card} cornerRadius={16}>
        <View style={styles.cardInner}>
          <Text style={styles.cardLabel}>PROFILE</Text>
          <Text style={styles.profileName}>{user?.full_name || "Driver"}</Text>
          <Text style={styles.profileEmail}>{user?.email || "--"}</Text>
          <Text style={styles.profileRole}>{user?.role || "driver"}</Text>
        </View>
      </GlassCard>

      {vehicle && (
        <TouchableOpacity
          onPress={() => navigation.navigate("VehicleOnboarding", { vehicle })}
        >
          <GlassCard style={styles.card} cornerRadius={16}>
            <View style={styles.cardInner}>
              <Text style={styles.cardLabel}>VEHICLE</Text>
              <Text style={styles.profileName}>{vehicle.vehicle_code}</Text>
              <Text style={styles.profileEmail}>
                {vehicle.make} {vehicle.model}
              </Text>
              {vehicle.spec_incomplete && (
                <Text style={styles.specWarning}>
                  ⚠ Specs incomplete — tap to update
                </Text>
              )}
            </View>
          </GlassCard>
        </TouchableOpacity>
      )}

      <GlassCard style={styles.card} cornerRadius={16}>
        <View style={styles.cardInner}>
          <Text style={styles.cardLabel}>ABOUT</Text>
          <Text style={styles.profileEmail}>Trickee GPS-First v2.0.0</Text>
          <Text style={styles.profileEmail}>Model: physics_baseline</Text>
          <Text style={styles.profileEmail}>Data: GPS + Vehicle Specs</Text>
        </View>
      </GlassCard>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, paddingTop: 56, paddingBottom: 100 },
  title: {
    color: Colors.primaryText,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 16,
  },
  card: { marginBottom: 12 },
  cardInner: { padding: 16 },
  cardLabel: {
    color: Colors.secondaryText,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
  },
  profileName: { color: Colors.primaryText, fontSize: 18, fontWeight: "700" },
  profileEmail: { color: Colors.secondaryText, fontSize: 13, marginTop: 2 },
  profileRole: {
    color: Colors.trickeeYellow,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
    textTransform: "uppercase",
  },
  specWarning: {
    color: Colors.red,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 6,
  },
  logoutBtn: {
    borderWidth: 1,
    borderColor: Colors.red,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  logoutText: { color: Colors.red, fontWeight: "700", fontSize: 15 },
});

export default SettingsScreen;
