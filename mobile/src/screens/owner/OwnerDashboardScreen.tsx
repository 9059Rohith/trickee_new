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
    void load();
  }, [load]);
  if (loading && !summary) {
    return <LoadingState label="Calculating fleet results…" />;
  }
  if (error && !summary) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
        />
      }
    >
      <Text style={styles.title}>Owner Intelligence</Text>
      <Text style={styles.subtitle}>
        GPS + vehicle specifications · precise provenance on every result
      </Text>
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
                      : "Need SOC"}
                    <Text style={styles.unit}>
                      {item.range_available ? " km" : ""}
                    </Text>
                  </Text>
                </View>
                <ConfidenceIndicator confidence={pred?.confidence} />
                <Text style={styles.policy}>
                  {item.range_available
                    ? `Recent SOC: ${fmt(item.soc?.value, 0)}%`
                    : "Remaining range hidden until a recent SOC is recorded."}
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
  content: { padding: 18, paddingTop: 60, paddingBottom: 40 },
  title: { color: Colors.primaryText, fontSize: 26, fontWeight: "800" },
  subtitle: {
    color: Colors.secondaryText,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 18,
  },
  card: { marginBottom: 12 },
  inner: { padding: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  label: {
    color: Colors.secondaryText,
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 12,
  },
  vehicle: { color: Colors.primaryText, fontSize: 18, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 14 },
  metric: {
    color: Colors.primaryText,
    fontSize: 19,
    fontWeight: "800",
    width: "50%",
  },
  unit: { color: Colors.secondaryText, fontSize: 10, fontWeight: "600" },
  policy: { color: Colors.secondaryText, fontSize: 11, marginTop: 10 },
});

export default OwnerDashboardScreen;
