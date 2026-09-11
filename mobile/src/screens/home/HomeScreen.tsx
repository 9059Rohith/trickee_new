/**
 * HomeScreen — GPS-First dashboard.
 *
 * GPS-first additions (§3):
 * - "Estimated" badge next to range/energy numbers
 * - "Add SOC reading" quick action when no recent SOC
 * - TripActiveBanner when GPS tracking is running
 * - Shows estimated_wh_per_km and soc_consumed when SOC absent
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { Colors } from "../../constants/Colors";
import GlassCard from "../../components/GlassCard";
import EstimatedBadge from "../../components/EstimatedBadge";
import ConfidenceIndicator from "../../components/ConfidenceIndicator";
import TripActiveBanner from "../../components/TripActiveBanner";
import DriverActionSheet from "../../components/DriverActionSheet";
import SOCEntryModal from "../../components/SOCEntryModal";
import { LoadingState, ErrorState } from "../../components/StateViews";
import { useLiveData } from "../../context/LiveDataContext";
import {
  acknowledgeStationaryNudge,
  telemetryStatus,
} from "../../services/telemetryNative";

const fmt = (val: number | null | undefined, digits = 1) =>
  typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "--";

const HomeScreen: React.FC = () => {
  const {
    me,
    vehicle,
    driver,
    gpsSummary,
    latestSoc,
    loading,
    refreshing,
    error,
    refresh,
    ackAlert,
  } = useLiveData();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [socModalVisible, setSocModalVisible] = useState(false);
  const [stationaryNudgeVisible, setStationaryNudgeVisible] = useState(false);
  const [stationarySnoozedUntil, setStationarySnoozedUntil] = useState(0);

  const activeTrip = me?.active_trip ?? null;
  const activeTripId = activeTrip?.id ?? null;
  const vehicleCode = vehicle?.vehicle_code || "No vehicle";
  const driverCode = driver?.driver_code || "--";
  const driverStyle = driver?.style_label || "Unknown";
  const unresolved = (me?.alerts || []).filter((a) => !a.is_resolved);

  useEffect(() => {
    if (!activeTripId) {
      setStationaryNudgeVisible(false);
      setStationarySnoozedUntil(0);
      return;
    }
    let cancelled = false;
    const checkStationaryNudge = async () => {
      const status = await telemetryStatus().catch(() => null);
      if (cancelled || !status) return;
      if (!status.stationaryNudgePending) {
        setStationaryNudgeVisible(false);
        return;
      }
      if (Date.now() < stationarySnoozedUntil) return;
      setStationaryNudgeVisible(true);
    };
    checkStationaryNudge();
    const interval = setInterval(checkStationaryNudge, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTripId, stationarySnoozedUntil]);

  if (loading && !me) {
    return <LoadingState label="Loading your fleet…" />;
  }
  if (error && !me) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  // GPS-first data
  const pred = gpsSummary?.latest_prediction;
  const hasRecentSoc = gpsSummary?.soc?.is_recent ?? false;
  const estimatedRange = gpsSummary?.estimated_range_km;
  const hasEstimatedRange = hasRecentSoc && estimatedRange != null;
  const whPerKm = pred?.wh_per_km;
  const demandScore = pred?.demand_score;
  const confidence = pred?.confidence;
  const source = pred?.source || "physics_baseline";

  return (
    <View style={styles.container}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={Colors.trickeeYellow}
            colors={[Colors.trickeeYellow]}
          />
        }
      >
        {/* GPS TRACKING BANNER */}
        {activeTrip && (
          <TripActiveBanner tripStartedAt={activeTrip.started_at} />
        )}

        {stationaryNudgeVisible ? (
          <View accessibilityLiveRegion="assertive" style={styles.stationaryCard}>
            <Text style={styles.stationaryTitle}>Are you waiting?</Text>
            <Text style={styles.stationaryCopy}>The vehicle has been stationary for 7 minutes. Continue the trip, end it, or ask again in 5 minutes.</Text>
            <View style={styles.stationaryActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Continue current trip"
                style={styles.stationarySecondary}
                onPress={() => {
                  setStationaryNudgeVisible(false);
                  acknowledgeStationaryNudge().catch(() => setStationaryNudgeVisible(true));
                }}
              ><Text style={styles.stationarySecondaryText}>Continue trip</Text></TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Remind me about the stationary trip in 5 minutes"
                style={styles.stationarySecondary}
                onPress={() => {
                  setStationarySnoozedUntil(Date.now() + 5 * 60_000);
                  setStationaryNudgeVisible(false);
                }}
              ><Text style={styles.stationarySecondaryText}>Remind in 5 min</Text></TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="End current trip"
                style={styles.stationaryEnd}
                onPress={() => {
                  setStationaryNudgeVisible(false);
                  acknowledgeStationaryNudge().catch(() => {});
                  setActionsOpen(true);
                }}
              ><Text style={styles.stationaryEndText}>End trip</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* ACTIVE ORDER CARD */}
        <GlassCard style={styles.orderCard} cornerRadius={20}>
          <View style={styles.cardInner}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>ACTIVE ORDER</Text>
              {activeTrip ? (
                <View style={styles.liveBadge}>
                  <View style={styles.greenDot} />
                  <Text style={styles.liveText}>TRACK LIVE</Text>
                </View>
              ) : (
                <View style={styles.idleBadge}>
                  <Text style={styles.idleText}>IDLE</Text>
                </View>
              )}
            </View>
            <Text style={styles.vehicleCode}>{vehicleCode}</Text>
            <Text style={styles.driverInfo}>
              {driverCode} · {driverStyle}
            </Text>
          </View>
        </GlassCard>

        {/* ENERGY & RANGE CARD */}
        <GlassCard style={styles.metricsCard} cornerRadius={20}>
          <View style={styles.cardInner}>
            <View style={styles.metricsHeader}>
              <Text style={styles.cardLabel}>ENERGY INTELLIGENCE</Text>
              <EstimatedBadge
                source={source}
                estimated={pred?.estimated ?? true}
                size="medium"
              />
            </View>

            <View style={styles.metricsGrid}>
              {/* SOC / Range */}
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>
                  {hasEstimatedRange ? "Est. Range" : "Last SOC"}
                </Text>
                <Text style={styles.metricValue}>
                  {hasEstimatedRange
                    ? `${fmt(estimatedRange, 0)} km`
                    : latestSoc != null
                    ? `${fmt(latestSoc, 0)}%`
                    : "--"}
                </Text>
                {!hasRecentSoc && (
                  <TouchableOpacity
                    style={styles.addSocBtn}
                    onPress={() => setSocModalVisible(true)}
                  >
                    <Text style={styles.addSocText}>+ Add SOC</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Wh/km */}
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Wh/km</Text>
                <Text style={styles.metricValue}>{fmt(whPerKm)}</Text>
              </View>

              {/* Demand Score */}
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Demand</Text>
                <Text style={styles.metricValue}>{fmt(demandScore, 0)}</Text>
                <ConfidenceIndicator
                  confidence={confidence}
                  showLabel={false}
                />
              </View>

              {/* When no recent SOC: show estimated % consumed instead of range */}
              {!hasRecentSoc && pred?.soc_consumed_pct != null && (
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Est. SOC Used</Text>
                  <Text style={styles.metricValue}>
                    {fmt(pred.soc_consumed_pct, 0)}%
                  </Text>
                </View>
              )}
            </View>

            {vehicle?.spec_incomplete && (
              <View style={styles.specWarning}>
                <Text style={styles.specWarningText}>
                  ⚠ Vehicle specs incomplete — predictions unavailable
                </Text>
              </View>
            )}
          </View>
        </GlassCard>

        {/* ALERTS */}
        {unresolved.length > 0 && (
          <GlassCard style={styles.alertsCard} cornerRadius={16}>
            <View style={styles.cardInner}>
              <Text style={styles.cardLabel}>ALERTS ({unresolved.length})</Text>
              {unresolved.slice(0, 3).map((a) => (
                <View key={a.id} style={styles.alertItem}>
                  <Text style={styles.alertMsg}>{a.message}</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Dismiss alert: ${a.message}`} style={styles.alertAction} onPress={() => ackAlert(a.id)}>
                    <Text style={styles.alertDismiss}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </GlassCard>
        )}

      </ScrollView>

      <View style={styles.stickyAction}>
        <TouchableOpacity
          testID={activeTrip ? "end-trip-button" : "start-trip-button"}
          accessibilityRole="button"
          accessibilityLabel={activeTrip ? "End current trip" : "Start a new trip"}
          style={[styles.actionBtn, activeTrip && styles.endTripBtn]}
          onPress={() => setActionsOpen(true)}
        >
          <Text style={[styles.actionBtnText, activeTrip && styles.endTripText]}>
            {activeTrip ? "End Trip" : "Start Trip"}
          </Text>
        </TouchableOpacity>
      </View>

      <DriverActionSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
      />

      {vehicle && (
        <SOCEntryModal
          visible={socModalVisible}
          onClose={() => setSocModalVisible(false)}
          vehicleId={vehicle.id}
          onRecorded={refresh}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 56, paddingBottom: 130 },
  orderCard: { marginBottom: 12 },
  metricsCard: { marginBottom: 12 },
  alertsCard: { marginBottom: 12 },
  cardInner: { padding: 16 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardLabel: {
    color: Colors.secondaryText,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.neonGreen,
  },
  liveText: { color: Colors.neonGreen, fontSize: 10, fontWeight: "700" },
  idleBadge: {},
  idleText: { color: Colors.secondaryText, fontSize: 10, fontWeight: "700" },
  vehicleCode: { color: Colors.primaryText, fontSize: 22, fontWeight: "700" },
  driverInfo: { color: Colors.secondaryText, fontSize: 13, marginTop: 2 },
  metricsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  metricsGrid: { flexDirection: "row", gap: 12 },
  metricItem: { flex: 1, alignItems: "center" },
  metricLabel: {
    color: Colors.secondaryText,
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  metricValue: { color: Colors.primaryText, fontSize: 24, fontWeight: "700" },
  addSocBtn: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.estimatedBadgeBg,
  },
  addSocText: { color: Colors.trickeeYellow, fontSize: 10, fontWeight: "700" },
  specWarning: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,68,68,0.08)",
  },
  specWarningText: { color: Colors.red, fontSize: 11, fontWeight: "600" },
  alertItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  alertMsg: { color: Colors.primaryText, fontSize: 13, flex: 1 },
  alertDismiss: {
    color: Colors.trickeeYellow,
    fontSize: 12,
    fontWeight: "600",
  },
  alertAction: { minWidth: 64, minHeight: 44, alignItems: "flex-end", justifyContent: "center", paddingLeft: 10 },
  stickyAction: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, backgroundColor: Colors.appBackground, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  actionBtn: {
    backgroundColor: Colors.trickeeYellow,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
  },
  actionBtnText: { color: Colors.darkText, fontWeight: "800", fontSize: 16 },
  endTripBtn: { backgroundColor: Colors.red },
  endTripText: { color: Colors.white },
  stationaryCard: { borderRadius: 16, borderWidth: 1, borderColor: Colors.trickeeYellow, backgroundColor: "rgba(255,202,32,0.1)", padding: 14, gap: 9, marginBottom: 12 },
  stationaryTitle: { color: Colors.white, fontSize: 17, fontWeight: "900" },
  stationaryCopy: { color: Colors.primaryText, fontSize: 14, lineHeight: 20 },
  stationaryActions: { gap: 8 },
  stationarySecondary: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: Colors.premiumCardBorder },
  stationarySecondaryText: { color: Colors.neonBlue, fontSize: 14, fontWeight: "800" },
  stationaryEnd: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: Colors.red },
  stationaryEndText: { color: Colors.white, fontSize: 14, fontWeight: "900" },
});

export default HomeScreen;
