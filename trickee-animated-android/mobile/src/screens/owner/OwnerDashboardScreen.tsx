import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { Colors } from "../../constants/Colors";
import { motionColors } from "../../motion/tokens";
import { fontFamily } from "../../theme/typography";
import GlassCard from "../../components/GlassCard";
import EstimatedBadge from "../../components/EstimatedBadge";
import ConfidenceIndicator from "../../components/ConfidenceIndicator";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../components/StateViews";

type Summary = Awaited<ReturnType<typeof api.ownerSummary>>;
const fmt = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "--";

const OwnerDashboardScreen: React.FC = () => {
  const { token } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (!token) {
        return;
      }
      refresh ? setRefreshing(true) : setLoading(true);
      try {
        setSummary(await api.ownerSummary(token));
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load owner summary."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    load();
  }, [load]);
  if (loading && !summary) {
    return <LoadingState label="Calculating fleet results…" />;
  }
  if (error && !summary) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
        />
      }
    >
      <Text style={styles.kicker}>FLEET COCKPIT / 01</Text>
      <Text style={styles.title}>Owner Intelligence</Text>
      <Text style={styles.subtitle}>
        GPS and vehicle specifications with clear source data
      </Text>
      <View style={styles.heroRule} />
      <GlassCard style={styles.card} cornerRadius={18}>
        <View style={styles.inner}>
          <Text style={styles.label}>FLEET TOTALS</Text>
          <View style={styles.grid}>
            <Text style={styles.metric}>
              {summary?.totals.vehicles ?? 0}
              <Text style={styles.unit}> vehicles</Text>
            </Text>
            <Text style={styles.metric}>
              {summary?.totals.trips ?? 0}
              <Text style={styles.unit}> trips</Text>
            </Text>
            <Text style={styles.metric}>
              {fmt(summary?.totals.distance_km)}
              <Text style={styles.unit}> km</Text>
            </Text>
            <Text style={styles.metric}>
              {fmt(summary?.totals.route_energy_kwh, 2)}
              <Text style={styles.unit}> kWh</Text>
            </Text>
          </View>
        </View>
      </GlassCard>
      {!summary?.vehicles.length ? (
        <EmptyState
          title="No active vehicles"
          subtitle="Add a vehicle to begin GPS calculations."
        />
      ) : (
        summary.vehicles.map((item) => {
          const pred = item.latest_prediction;
          const hasRecentSoc = item.soc?.is_recent === true;
          const missingModel = hasRecentSoc && !pred?.wh_per_km;
          const rangeReason = !hasRecentSoc
            ? "Need SOC"
            : item.spec_incomplete
              ? "Check specs"
              : "Model pending";
          return (
            <GlassCard
              key={item.vehicle_id}
              style={styles.card}
              cornerRadius={18}
            >
              <View style={styles.inner}>
                <View style={styles.row}>
                  <Text style={styles.vehicle}>{item.vehicle_code}</Text>
                  <EstimatedBadge
                    source={pred?.source}
                    estimated={pred?.estimated ?? true}
                  />
                </View>
                <View style={styles.grid}>
                  <Text style={styles.metric}>
                    {fmt(pred?.wh_per_km)}
                    <Text style={styles.unit}> Wh/km</Text>
                  </Text>
                  <Text style={styles.metric}>
                    {fmt(item.route_energy_kwh, 2)}
                    <Text style={styles.unit}> kWh</Text>
                  </Text>
                  <Text style={styles.metric}>
                    {fmt(pred?.demand_score, 0)}
                    <Text style={styles.unit}> demand</Text>
                  </Text>
                  <Text style={styles.metric}>
                    {item.range_available
                      ? fmt(item.estimated_range_km, 0)
                      : rangeReason}
                    <Text style={styles.unit}>
                      {item.range_available ? " km" : ""}
                    </Text>
                  </Text>
                </View>
                <ConfidenceIndicator confidence={pred?.confidence} />
                <Text style={styles.policy}>
                  {item.range_available
                    ? `Recent SOC: ${fmt(item.soc?.value, 0)}%`
                    : !hasRecentSoc
                      ? "Remaining range hidden until a recent SOC is recorded."
                      : item.spec_incomplete
                        ? "Vehicle specifications are needed for a range estimate."
                        : missingModel
                          ? `Recent SOC: ${fmt(item.soc?.value, 0)}%. Range awaits trip processing.`
                          : "Range estimate is currently unavailable."}
                </Text>
              </View>
            </GlassCard>
          );
        })
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 18, paddingTop: 22, paddingBottom: 40 },
  kicker: { color: motionColors.cyan, fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 1.2 },
  title: { color: Colors.primaryText, fontFamily: fontFamily.headingBold, fontSize: 29, lineHeight: 35, letterSpacing: -0.7, marginTop: 10 },
  subtitle: {
    color: Colors.secondaryText,
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  heroRule: { height: 1, backgroundColor: "rgba(72,223,244,0.18)", marginTop: 18, marginBottom: 20 },
  card: { marginBottom: 14 },
  inner: { padding: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  label: {
    color: motionColors.cyan,
    fontFamily: fontFamily.technical,
    fontSize: 8,
    letterSpacing: 0.7,
    marginBottom: 16,
  },
  vehicle: { color: Colors.primaryText, fontFamily: fontFamily.headingBold, fontSize: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 18 },
  metric: {
    color: Colors.primaryText,
    fontFamily: fontFamily.bodyBold,
    fontSize: 20,
    width: "50%",
  },
  unit: { color: Colors.secondaryText, fontFamily: fontFamily.bodyMedium, fontSize: 10 },
  policy: { color: Colors.secondaryText, fontFamily: fontFamily.body, fontSize: 11, lineHeight: 16, marginTop: 12 },
});

export default OwnerDashboardScreen;
