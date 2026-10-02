/**
 * MonitoringScreen — vehicle monitoring with GPS-first confidence indicators.
 *
 * GPS-first additions (§3):
 * - Confidence indicator next to energy metrics
 * - "Estimated" / "Live" badge
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Colors } from "../../constants/Colors";
import { motionColors } from "../../motion/tokens";
import { fontFamily } from "../../theme/typography";
import GlassCard from "../../components/GlassCard";
import EstimatedBadge from "../../components/EstimatedBadge";
import ConfidenceIndicator from "../../components/ConfidenceIndicator";
import { LoadingState, ErrorState } from "../../components/StateViews";
import { useLiveData } from "../../context/LiveDataContext";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { freshnessPresentation, metricText } from "../../services/presentation";

const fmt = (val: number | null | undefined, d = 1) =>
  typeof val === "number" && Number.isFinite(val) ? val.toFixed(d) : "--";

const MonitoringScreen: React.FC = () => {
  const { me, vehicle, gpsSummary, liveState, loading, error, refresh } = useLiveData();
  const [technicalOpen, setTechnicalOpen] = useState(false);

  if (loading && !me) {
    return <LoadingState />;
  }
  if (error && !me) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  const pred = gpsSummary?.latest_prediction;
  const soc = gpsSummary?.soc;
  const freshness = freshnessPresentation(liveState?.event_time);
  const freshnessColor = freshness.state === "live" ? Colors.neonGreen : freshness.state === "offline" ? Colors.red : Colors.trickeeYellow;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>VEHICLE INTELLIGENCE / 02</Text>
      <View style={styles.header}>
        <Text style={styles.title}>Vehicle monitoring</Text>
        <EstimatedBadge
          source={pred?.source}
          estimated={pred?.estimated ?? true}
          size="medium"
        />
      </View>
      <View style={styles.heroRule} />

      <GlassCard style={styles.card} cornerRadius={16}>
        <View style={styles.cardInner}>
          <View style={styles.row}>
            <Text style={styles.cardLabel}>TRACKING STATUS</Text>
            <View style={styles.liveBadge}>
              <Icon
                name={freshness.state === "live" ? "access-point" : freshness.state === "offline" ? "access-point-off" : "clock-outline"}
                size={13}
                color={freshnessColor}
              />
              <Text style={[styles.liveBadgeText, { color: freshnessColor }]}>{freshness.state.toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>GPS updates</Text>
              <Text style={styles.gridValue}>{freshness.state === "live" ? "Working" : freshness.state === "waiting" ? "Waiting" : "Needs attention"}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Trip distance</Text>
              <Text style={styles.gridValue}>{metricText(liveState?.distance_km, 2, "km")}</Text>
            </View>
          </View>
          <Text style={styles.evidenceText}>
            {freshness.label}
          </Text>
        </View>
      </GlassCard>

      {/* Latest stored model prediction, distinct from the live GPS stream above. */}
      <GlassCard style={styles.card} cornerRadius={16}>
        <View style={styles.cardInner}>
          <View style={styles.row}>
            <Text style={styles.cardLabel}>BATTERY AND TRIP ESTIMATE</Text>
            <ConfidenceIndicator confidence={pred?.confidence} />
          </View>

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Wh/km</Text>
              <Text style={styles.gridValue}>{fmt(pred?.wh_per_km)}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Route Energy</Text>
              <Text style={styles.gridValue}>
                {fmt(pred?.route_energy_wh, 0)} Wh
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Demand Score</Text>
              <Text style={styles.gridValue}>
                {fmt(pred?.demand_score, 0)}/100
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>SOC Consumed</Text>
              <Text style={styles.gridValue}>
                {pred?.soc_consumed_pct != null
                  ? `~${fmt(pred.soc_consumed_pct, 0)}%`
                  : "--"}
              </Text>
            </View>
          </View>
        </View>
      </GlassCard>

      {/* Battery Status */}
      <GlassCard style={styles.card} cornerRadius={16}>
        <View style={styles.cardInner}>
          <Text style={styles.cardLabel}>BATTERY STATUS</Text>
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Last SOC</Text>
              <Text style={styles.gridValue}>
                {soc?.value != null ? `${fmt(soc.value, 0)}%` : "--"}
              </Text>
              <Text style={styles.gridSub}>{soc?.source || "No reading"}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Est. Range</Text>
              <Text style={styles.gridValue}>
                {gpsSummary?.estimated_range_km != null
                  ? `${fmt(gpsSummary.estimated_range_km, 0)} km`
                  : "Need SOC"}
              </Text>
            </View>
          </View>
        </View>
      </GlassCard>

      {/* Vehicle Specs */}
      <GlassCard style={styles.card} cornerRadius={16}>
        <View style={styles.cardInner}>
          <Text style={styles.cardLabel}>VEHICLE DETAILS</Text>
          {vehicle?.spec_incomplete ? (
            <Text style={styles.specWarning}>
              ⚠ Specs incomplete — update for predictions
            </Text>
          ) : (
            <View style={styles.specGrid}>
              <Text style={styles.specItem}>Make: {vehicle?.make || "--"}</Text>
              <Text style={styles.specItem}>
                Model: {vehicle?.model || "--"}
              </Text>
              <Text style={styles.specItem}>
                Category: {vehicle?.category || "--"}
              </Text>
              <Text style={styles.specItem}>
                Usable battery: {vehicle?.usable_kwh ?? vehicle?.battery_capacity_kwh ?? "Unavailable"} kWh
              </Text>
              <Text style={styles.specItem}>
                Motor: {vehicle?.motor_kw || "--"} kW
              </Text>
              <Text style={styles.specItem}>
                Weight: {vehicle?.kerb_weight || "--"} kg
              </Text>
            </View>
          )}
        </View>
      </GlassCard>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${technicalOpen ? "Hide" : "Show"} technical monitoring details`} accessibilityState={{ expanded: technicalOpen }} style={styles.technicalToggle} onPress={() => setTechnicalOpen(value => !value)}>
        <Text style={styles.technicalToggleText}>{technicalOpen ? "Hide technical details" : "Show technical details"}</Text>
        <Icon name={technicalOpen ? "chevron-up" : "chevron-down"} size={20} color={Colors.neonBlue} />
      </TouchableOpacity>
      {technicalOpen ? <GlassCard style={styles.card} cornerRadius={16}><View style={styles.cardInner}>
        <Text style={styles.cardLabel}>TECHNICAL DETAILS</Text>
        <Text style={styles.specItem}>Sequence: {liveState?.sequence_no ?? "Unavailable"}</Text>
        <Text style={styles.specItem}>Stored event: {liveState?.event_time ? new Date(liveState.event_time).toLocaleString() : "Unavailable"}</Text>
        <Text style={styles.specItem}>Model source: {pred?.source || "Unavailable"}</Text>
        <Text style={styles.specItem}>Confidence: {pred?.confidence != null ? `${fmt(Number(pred.confidence) * 100, 0)}%` : "Unavailable"}</Text>
      </View></GlassCard> : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 100 },
  eyebrow: { color: motionColors.cyan, fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 1.1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 19,
  },
  heroRule: { height: 1, backgroundColor: "rgba(72,223,244,0.18)", marginBottom: 22 },
  title: { color: Colors.primaryText, fontFamily: fontFamily.headingBold, fontSize: 26, letterSpacing: -0.8, flexShrink: 1 },
  card: { marginBottom: 12 },
  cardInner: { padding: 19 },
  cardLabel: {
    color: motionColors.cyan,
    fontFamily: fontFamily.technical,
    fontSize: 8,
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridItem: { width: "45%", marginBottom: 8 },
  gridLabel: {
    color: "#93A6AA",
    fontFamily: fontFamily.technical,
    fontSize: 7,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  gridValue: { color: Colors.primaryText, fontFamily: fontFamily.headingBold, fontSize: 21 },
  gridSub: { color: Colors.secondaryText, fontSize: 9, marginTop: 2 },
  specWarning: { color: Colors.red, fontSize: 12, fontWeight: "600" },
  specGrid: { gap: 4 },
  specItem: { color: Colors.primaryText, fontSize: 13 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveBadgeText: { color: Colors.primaryText, fontSize: 10, fontWeight: "800" },
  evidenceText: { color: Colors.secondaryText, fontSize: 11, lineHeight: 17, marginTop: 10 },
  technicalToggle: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 13, marginBottom: 12 },
  technicalToggleText: { color: Colors.neonBlue, fontSize: 14, fontWeight: "800" },
});

export default MonitoringScreen;
