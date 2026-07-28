import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../constants/Colors";
import GlassCard from "../../components/GlassCard";
import BackgroundLogo from "../../components/BackgroundLogo";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";

interface MoreMenuScreenProps {
  onNavigate: (screen: string) => void;
  onLogout: () => void;
}

const MoreMenuScreen: React.FC<MoreMenuScreenProps> = ({
  onNavigate,
  onLogout,
}) => {
  const { user } = useAuth();
  const { driver, vehicle, telemetry, gpsSummary, latestSoc } = useLiveData();
  const menuItems = [
    {
      id: "aiIntel",
      icon: "head-cog",
      label: "AI Intelligence",
      color: Colors.trickeeYellow,
    },
    {
      id: "routeIntel",
      icon: "routes",
      label: "Route Intel",
      color: Colors.neonBlue,
    },
    {
      id: "pastTrips",
      icon: "history",
      label: "Past Trips",
      color: Colors.neonPurple,
    },
    {
      id: "dailyImpact",
      icon: "leaf",
      label: "Daily Impact",
      color: Colors.neonGreen,
    },
  ];

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Fleet Controls</Text>
        </View>

        <View style={styles.menuList}>
          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => onNavigate(item.id)}
              activeOpacity={0.7}
            >
              <GlassCard style={styles.menuCard} cornerRadius={18}>
                <View style={styles.menuRow}>
                  <View
                    style={[
                      styles.menuIconCircle,
                      { backgroundColor: `${item.color}20` },
                    ]}
                  >
                    <Icon name={item.icon} size={20} color={item.color} />
                  </View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Icon
                    name="chevron-right"
                    size={14}
                    color="rgba(255,255,255,0.4)"
                  />
                </View>
              </GlassCard>
            </TouchableOpacity>
          ))}
        </View>

        {/* Profile card */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>PROFILE</Text>
        </View>

        <GlassCard cornerRadius={20}>
          <View style={styles.profileContent}>
            <View style={styles.profileHeader}>
              <View style={styles.avatarCircle}>
                <Icon name="account" size={40} color={Colors.trickeeYellow} />
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>
                  {user?.full_name || driver?.full_name || "Trickee User"}
                </Text>
                <Text style={styles.profileRole}>
                  {user?.role?.replace("_", " ") || "Driver"}
                </Text>
              </View>
            </View>

            <View style={styles.profileDivider} />

            <View style={styles.profileDetail}>
              <Icon name="email" size={14} color={Colors.trickeeYellow} />
              <Text style={styles.profileDetailLabel}>Email</Text>
              <Text style={styles.profileDetailValue}>
                {user?.email || "Not signed in"}
              </Text>
            </View>
            <View style={styles.profileDetail}>
              <Icon name="briefcase" size={14} color={Colors.trickeeYellow} />
              <Text style={styles.profileDetailLabel}>Company</Text>
              <Text style={styles.profileDetailValue}>
                {vehicle?.make || "EVIFY"}
              </Text>
            </View>
            <View style={styles.profileDetail}>
              <Icon name="clock" size={14} color={Colors.trickeeYellow} />
              <Text style={styles.profileDetailLabel}>Last Active</Text>
              <Text style={styles.profileDetailValue}>
                {telemetry?.recorded_at
                  ? new Date(telemetry.recorded_at).toLocaleString()
                  : "Just now"}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Fleet Statistics */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>FLEET STATISTICS</Text>
        </View>

        <View style={styles.statsRow}>
          <GlassCard style={styles.statCard} cornerRadius={14}>
            <View style={styles.statContent}>
              <Icon
                name="car-multiple"
                size={18}
                color="rgba(255,255,255,0.6)"
              />
              <Text style={styles.statValue}>{vehicle ? "1" : "0"}</Text>
              <Text style={styles.statLabel}>Assigned Vehicles</Text>
            </View>
          </GlassCard>
          <GlassCard style={styles.statCard} cornerRadius={14}>
            <View style={styles.statContent}>
              <Icon name="head-cog" size={18} color="rgba(255,255,255,0.6)" />
              <Text style={styles.statValue}>
                {driver?.style_label || "--"}
              </Text>
              <Text style={styles.statLabel}>Driver Archetype</Text>
            </View>
          </GlassCard>
          <GlassCard style={styles.statCard} cornerRadius={14}>
            <View style={styles.statContent}>
              <Icon name="star" size={18} color={Colors.trickeeYellow} />
              <Text style={styles.statValue}>
                {gpsSummary?.soc?.is_recent && latestSoc != null
                  ? `${latestSoc.toFixed(1)}%`
                  : "Need SOC"}
              </Text>
              <Text style={styles.statLabel}>Current SOC</Text>
            </View>
          </GlassCard>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Icon name="power" size={18} color={Colors.buttonText} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>TRICKEE PLATFORM v2.4</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.appBackground,
  },
  watermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0,
  },
  watermarkImage: {
    width: "100%",
    height: "100%",
    opacity: 0.15,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 160,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.white,
  },
  menuList: {
    gap: 12,
  },
  menuCard: {
    height: 70,
    justifyContent: "center",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    flex: 1,
  },
  menuIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.white,
  },

  sectionHeader: {
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 1.5,
  },

  profileContent: {
    padding: 20,
    gap: 16,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255, 202, 32, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: {
    gap: 4,
  },
  profileName: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.white,
  },
  profileRole: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.6)",
  },
  profileDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  profileDetail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileDetailLabel: {
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    width: 80,
  },
  profileDetailValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.white,
  },

  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
  },
  statContent: {
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.white,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
  },

  logoutButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.trickeeYellow,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    shadowColor: Colors.trickeeYellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.buttonText,
  },

  versionText: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.3)",
    textAlign: "center",
    marginTop: 8,
  },
});

export default MoreMenuScreen;
