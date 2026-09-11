import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import {
  exportTelemetryDiagnostics,
  NativeTelemetryDiagnosticSummary,
  retryPendingTelemetry,
} from "../../services/telemetryNative";

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
  const [diagnosticSummary, setDiagnosticSummary] =
    useState<NativeTelemetryDiagnosticSummary | null>(null);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string | null>(
    null
  );
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [retryingTelemetry, setRetryingTelemetry] = useState(false);

  const handleDiagnosticExport = async () => {
    setExportingDiagnostics(true);
    setDiagnosticMessage(null);
    try {
      const summary = await exportTelemetryDiagnostics();
      setDiagnosticSummary(summary);
      setDiagnosticMessage(
        "Share sheet opened. Send the JSON file to the pilot support team."
      );
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error
          ? error.message
          : "Telemetry diagnostics could not be exported."
      );
    } finally {
      setExportingDiagnostics(false);
    }
  };

  const retryTelemetry = async () => {
    setRetryingTelemetry(true);
    setDiagnosticMessage(null);
    try {
      const result = await retryPendingTelemetry();
      setDiagnosticMessage(
        `${result.eligibleWindowCount} pending window(s) are eligible for upload. ` +
          `${result.permanentlyRejectedCount} unresolved rejected window(s) remain.`
      );
    } catch (error) {
      Alert.alert(
        "Retry failed",
        error instanceof Error
          ? error.message
          : "Pending telemetry could not be retried."
      );
    } finally {
      setRetryingTelemetry(false);
    }
  };

  const confirmTelemetryRetry = () => {
    Alert.alert(
      "Retry pending telemetry?",
      "This repairs the known Android sensor-status mismatch, then retries pending and expired in-flight windows for the latest ended trip. Acknowledged rows stay unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Retry", onPress: retryTelemetry },
      ]
    );
  };
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
          <Text style={styles.headerTitle}>More</Text>
        </View>

        <View style={styles.menuList}>
          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.label}`}
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
                {vehicle?.make || "xyz"}
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
          <Text style={styles.sectionLabel}>DRIVER SUMMARY</Text>
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
                {driver?.style_label || "Unavailable"}
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>TELEMETRY RECOVERY</Text>
        </View>

        <GlassCard cornerRadius={20}>
          <View style={styles.diagnosticContent}>
            <View style={styles.diagnosticTitleRow}>
              <Icon name="database-search" size={22} color={Colors.neonBlue} />
              <View style={styles.diagnosticTitleText}>
                <Text style={styles.diagnosticTitle}>
                  Local delivery diagnostics
                </Text>
                <Text style={styles.diagnosticCopy}>
                  Export first, then retry if support asks. The JSON contains
                  queue states and error details, but no GPS coordinates,
                  vehicle identifiers, device identifiers, or tokens.
                </Text>
              </View>
            </View>

            {diagnosticSummary ? (
              <View style={styles.diagnosticGrid}>
                <View style={styles.diagnosticMetric}>
                  <Text style={styles.diagnosticMetricValue}>
                    {diagnosticSummary.finalSequenceNo}
                  </Text>
                  <Text style={styles.diagnosticMetricLabel}>Phone final</Text>
                </View>
                <View style={styles.diagnosticMetric}>
                  <Text style={styles.diagnosticMetricValue}>
                    {diagnosticSummary.rowCount}
                  </Text>
                  <Text style={styles.diagnosticMetricLabel}>Local rows</Text>
                </View>
                <View style={styles.diagnosticMetric}>
                  <Text style={styles.diagnosticMetricValue}>
                    {diagnosticSummary.pendingCount +
                      diagnosticSummary.inFlightCount}
                  </Text>
                  <Text style={styles.diagnosticMetricLabel}>Pending</Text>
                </View>
                <View style={styles.diagnosticMetric}>
                  <Text style={styles.diagnosticMetricValue}>
                    {diagnosticSummary.permanentlyRejectedCount}
                  </Text>
                  <Text style={styles.diagnosticMetricLabel}>Rejected</Text>
                </View>
              </View>
            ) : null}

            {diagnosticMessage ? (
              <Text style={styles.diagnosticMessage}>{diagnosticMessage}</Text>
            ) : null}

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Export local telemetry diagnostics"
              accessibilityState={{ disabled: exportingDiagnostics || retryingTelemetry }}
              style={styles.diagnosticPrimaryButton}
              onPress={handleDiagnosticExport}
              disabled={exportingDiagnostics || retryingTelemetry}
            >
              {exportingDiagnostics ? (
                <ActivityIndicator size="small" color={Colors.buttonText} />
              ) : (
                <Icon name="file-export" size={18} color={Colors.buttonText} />
              )}
              <Text style={styles.diagnosticPrimaryText}>
                {exportingDiagnostics ? "Preparing export..." : "Export diagnostics"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry pending telemetry upload"
              accessibilityState={{ disabled: exportingDiagnostics || retryingTelemetry }}
              style={styles.diagnosticSecondaryButton}
              onPress={confirmTelemetryRetry}
              disabled={exportingDiagnostics || retryingTelemetry}
            >
              {retryingTelemetry ? (
                <ActivityIndicator size="small" color={Colors.neonBlue} />
              ) : (
                <Icon name="cloud-sync" size={18} color={Colors.neonBlue} />
              )}
              <Text style={styles.diagnosticSecondaryText}>
                {retryingTelemetry ? "Scheduling upload..." : "Retry pending telemetry"}
              </Text>
            </TouchableOpacity>
          </View>
        </GlassCard>

        {/* Logout */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Log out"
          style={styles.logoutButton}
          onPress={onLogout}
        >
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

  diagnosticContent: {
    padding: 18,
    gap: 14,
  },
  diagnosticTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  diagnosticTitleText: {
    flex: 1,
    gap: 5,
  },
  diagnosticTitle: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  diagnosticCopy: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    lineHeight: 18,
  },
  diagnosticGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  diagnosticMetric: {
    width: "48%",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  diagnosticMetricValue: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  diagnosticMetricLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    marginTop: 2,
  },
  diagnosticMessage: {
    color: Colors.neonGreen,
    fontSize: 12,
    lineHeight: 18,
  },
  diagnosticPrimaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: Colors.trickeeYellow,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  diagnosticPrimaryText: {
    color: Colors.buttonText,
    fontSize: 14,
    fontWeight: "700",
  },
  diagnosticSecondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,194,255,0.45)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  diagnosticSecondaryText: {
    color: Colors.neonBlue,
    fontSize: 14,
    fontWeight: "700",
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
