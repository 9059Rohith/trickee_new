/**
 * HomeScreen — GPS-First dashboard.
 *
 * GPS-first additions (§3):
 * - "Estimated" badge next to range/energy numbers
 * - "Add SOC reading" quick action when no recent SOC
 * - TripActiveBanner when GPS tracking is running
 * - Shows estimated_wh_per_km and soc_consumed when SOC absent
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { useAuth } from "../../context/AuthContext";
import { resumeRequirement } from "../../services/tripWaitFlow";
import {
  adoptServerTripWait,
  localTripWaitState,
  type LocalTripWaitState,
} from "../../services/tripWaitJournal";
import { beginWaitLocally, finishWaitLocally } from "../../services/tripWaitActions";
import { syncTripWaits } from "../../services/tripWaitSync";
import {
  acknowledgeStationaryNudge,
  telemetryStatus,
} from "../../services/telemetryNative";

const fmt = (val: number | null | undefined, digits = 1) =>
  typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "--";

const HomeScreen: React.FC = () => {
  const { token, restore } = useAuth();
  const {
    me,
    vehicle,
    driver,
    gpsSummary,
    latestSoc,
    loading,
    refreshing,
    lastUpdated,
    error: loadError,
    refresh,
    ackAlert,
  } = useLiveData();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [socModalVisible, setSocModalVisible] = useState(false);
  const [stationaryNudgeVisible, setStationaryNudgeVisible] = useState(false);
  const [stationarySnoozedUntil, setStationarySnoozedUntil] = useState(0);
  const [waitSubmitting, setWaitSubmitting] = useState(false);
  const [resumeSocVisible, setResumeSocVisible] = useState(false);
  const [savedWaitState, setSavedWaitState] = useState<{ tripId: string; data: LocalTripWaitState } | null>(null);
  const pendingWaitId = useRef<string | null>(null);
  const syncingWait = useRef(false);

  const activeTrip = me?.active_trip ?? null;
  const activeTripId = activeTrip?.id ?? null;
  const localWait = savedWaitState?.tripId === activeTripId ? savedWaitState.data : null;
  const serverWait = me?.active_waiting ?? null;
  const activeWait = localWait?.active ?? (
    serverWait && !localWait?.closedIds.includes(serverWait.id) ? serverWait : null
  );
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

  useEffect(() => {
    if (!activeTripId) {
      setSavedWaitState(null);
      return;
    }
    let cancelled = false;
    const reconcileWaits = async () => {
      try {
        const saved = await localTripWaitState(activeTripId);
        if (cancelled) return;
        setSavedWaitState({ tripId: activeTripId, data: saved });
        if (!saved.pendingCount || !token || syncingWait.current) return;
        syncingWait.current = true;
        try {
          const result = await syncTripWaits(token, restore, activeTripId);
          if (cancelled) return;
          setSavedWaitState({ tripId: activeTripId, data: await localTripWaitState(activeTripId) });
          if (result.pendingCount === 0) await refresh();
        } finally {
          syncingWait.current = false;
        }
      } catch (error) {
        if (!cancelled) Alert.alert("Stop history unavailable", error instanceof Error ? error.message : "Could not read saved stops.");
      }
    };
    reconcileWaits();
    return () => { cancelled = true; };
  }, [activeTripId, lastUpdated, token, restore, refresh]);

  const beginWait = async (vehicleCharging: boolean) => {
    if (!activeTripId || !token || waitSubmitting) return;
    setWaitSubmitting(true);
    try {
      const waitId = pendingWaitId.current || `wait-${activeTripId}-${Date.now()}`;
      pendingWaitId.current = waitId;
      await beginWaitLocally(activeTripId, waitId, vehicleCharging, () => syncTripWaits(token, restore, activeTripId));
      pendingWaitId.current = null;
      setStationaryNudgeVisible(false);
      setSavedWaitState({ tripId: activeTripId, data: await localTripWaitState(activeTripId) });
      await acknowledgeStationaryNudge().catch(() => {});
    } catch (error) {
      await refresh().catch(() => {});
      Alert.alert("Could not save the stop", error instanceof Error ? error.message : "Try again when connected.");
    } finally {
      setWaitSubmitting(false);
    }
  };

  const resumeWait = async (resumeSoc?: number) => {
    if (!activeTripId || !activeWait || !token || waitSubmitting) return;
    setWaitSubmitting(true);
    try {
      if (localWait?.active?.id !== activeWait.id) {
        await adoptServerTripWait(
          activeTripId,
          activeWait.id,
          activeWait.vehicle_charging,
          serverWait?.device_started_at || serverWait?.started_at || new Date().toISOString()
        );
      }
      await finishWaitLocally(activeTripId, activeWait.id, resumeSoc, () => syncTripWaits(token, restore, activeTripId));
      setSavedWaitState({ tripId: activeTripId, data: await localTripWaitState(activeTripId) });
      setResumeSocVisible(false);
    } catch (error) {
      await refresh().catch(() => {});
      throw error;
    } finally {
      setWaitSubmitting(false);
    }
  };

  const confirmCharging = () => {
    Alert.alert("Charging the vehicle?", "Your trip stays active during the stop.", [
      { text: "Yes, charging", onPress: () => { beginWait(true); } },
      { text: "No, just waiting", onPress: () => { beginWait(false); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const continueWait = () => {
    const requirement = resumeRequirement(activeWait);
    if (requirement === "post_charge_soc") {
      setResumeSocVisible(true);
    } else if (requirement === "resume_without_soc") {
      resumeWait().catch((error) =>
        Alert.alert("Could not resume trip", error instanceof Error ? error.message : "Try again when connected.")
      );
    }
  };

  if (loading && !me) {
    return <LoadingState label="Loading your fleet…" />;
  }
  if (loadError && !me) {
    return <ErrorState message={loadError} onRetry={refresh} />;
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

        {activeTrip && activeWait ? (
          <View accessibilityLiveRegion="polite" style={styles.stationaryCard}>
            <Text style={styles.stationaryTitle}>{activeWait.vehicle_charging ? "Charging stop" : "Waiting stop"}</Text>
            <Text style={styles.stationaryCopy}>This is still the same trip. GPS recording continues.</Text>
            {localWait?.pendingCount ? <Text style={styles.stationaryCopy}>Stop details will sync when connected.</Text> : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={activeWait.vehicle_charging ? "Charging complete, enter new SOC and resume trip" : "Resume current trip"}
              accessibilityState={{ disabled: waitSubmitting }}
              style={styles.stationarySecondary}
              onPress={continueWait}
              disabled={waitSubmitting}
            >
              <Text style={styles.stationarySecondaryText}>
                {activeWait.vehicle_charging ? "Charging complete · Resume" : "Resume trip"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : stationaryNudgeVisible ? (
          <View accessibilityLiveRegion="assertive" style={styles.stationaryCard}>
            <Text style={styles.stationaryTitle}>Are you waiting?</Text>
            <Text style={styles.stationaryCopy}>The vehicle has been stationary for 7 minutes. Are you stopping here?</Text>
            <View style={styles.stationaryActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="I am waiting, ask whether I am charging the vehicle"
                accessibilityState={{ disabled: waitSubmitting }}
                style={styles.stationarySecondary}
                onPress={confirmCharging}
                disabled={waitSubmitting}
              ><Text style={styles.stationarySecondaryText}>I'm waiting</Text></TouchableOpacity>
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
        ) : activeTrip ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="I am waiting or charging the vehicle"
            accessibilityState={{ disabled: waitSubmitting }}
            style={styles.stationarySecondary}
            onPress={confirmCharging}
            disabled={waitSubmitting}
          >
            <Text style={styles.stationarySecondaryText}>I'm waiting or charging</Text>
          </TouchableOpacity>
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
      {vehicle && activeWait?.vehicle_charging && (
        <SOCEntryModal
          visible={resumeSocVisible}
          onClose={() => setResumeSocVisible(false)}
          vehicleId={vehicle.id}
          title="SOC after charging"
          subtitle="Enter the battery percentage shown on the vehicle dashboard before you ride again."
          submitLabel="Resume same trip"
          showSourceSelector={false}
          onSubmit={resumeWait}
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
