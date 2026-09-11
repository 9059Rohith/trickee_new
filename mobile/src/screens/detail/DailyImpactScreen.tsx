import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../constants/Colors";
import DetailHeader from "../../components/DetailHeader";
import GlassCard from "../../components/GlassCard";
import BackgroundLogo from "../../components/BackgroundLogo";
import { ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api } from "../../services/api";
import type { Trip } from "../../services/types";

// Estimated CO2 avoided vs. a petrol two-wheeler (kg per km). Clearly an
// estimate, surfaced as such in the UI — not presented as measured.
const CO2_SAVED_PER_KM = 0.04;

const isToday = (iso?: string | null) => {
  if (!iso) {
    return false;
  }
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

const DailyImpactScreen: React.FC = () => {
  const { token } = useAuth();
  const { driver, alerts } = useLiveData();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh", signal?: AbortSignal) => {
      if (!token || !driver) {
        setLoading(false);
        return;
      }
      if (mode === "refresh") {
        setRefreshing(true);
      }
      try {
        const rows = await api.driverTrips(token, driver.id, 100, signal);
        setTrips(rows);
        setLoadError(null);
      } catch {
        if (!signal?.aborted) setLoadError("Daily impact could not refresh. Previously loaded values remain visible.");
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [token, driver]
  );

  useEffect(() => {
    const c = new AbortController();
    load("initial", c.signal);
    return () => c.abort();
  }, [load]);

  const today = useMemo(() => {
    const todays = trips.filter((t) => isToday(t.started_at));
    const distance = todays.reduce((s, t) => s + (t.distance_km || 0), 0);
    const energy = todays.reduce((s, t) => s + (t.kwh_used || 0), 0);
    return {
      tripCount: todays.length,
      distance,
      energy,
      co2Saved: distance * CO2_SAVED_PER_KM,
    };
  }, [trips]);

  const resolvedToday = alerts.filter((a) => a.is_resolved).length;

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader title="Daily Impact" subtitle="Your contribution today" />
      {loading ? (
        <LoadingState label="Calculating impact…" />
      ) : loadError && !trips.length ? (
        <ErrorState message="Daily impact is unavailable. No zero values have been assumed." onRetry={() => load("initial")} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load("refresh")}
              tintColor={Colors.trickeeYellow}
              colors={[Colors.trickeeYellow]}
            />
          }
        >
          {loadError ? <Text accessibilityLiveRegion="polite" style={styles.loadWarning}>{loadError}</Text> : null}
          {/* Hero CO2 */}
          <GlassCard cornerRadius={20}>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Icon name="leaf" size={34} color={Colors.neonGreen} />
              </View>
              <Text style={styles.heroValue}>
                {today.co2Saved.toFixed(2)} kg
              </Text>
              <Text style={styles.heroLabel}>ESTIMATED CO₂ AVOIDED TODAY</Text>
              <Text style={styles.heroNote}>
                vs. a petrol two-wheeler over {today.distance.toFixed(1)} km
              </Text>
            </View>
          </GlassCard>

          {/* Metric grid */}
          <View style={styles.grid}>
            <Metric
              icon="map-marker-distance"
              color={Colors.trickeeYellow}
              value={`${today.distance.toFixed(1)} km`}
              label="Distance today"
            />
            <Metric
              icon="flash"
              color={Colors.neonBlue}
              value={`${today.energy.toFixed(2)} kWh`}
              label="Energy used"
            />
            <Metric
              icon="map-marker-path"
              color={Colors.neonPurple}
              value={`${today.tripCount}`}
              label="Trips today"
            />
            <Metric
              icon="shield-check"
              color={Colors.neonGreen}
              value={`${resolvedToday}`}
              label="Resolved alerts (all time)"
            />
          </View>

          {today.tripCount === 0 && (
            <GlassCard cornerRadius={16}>
              <View style={styles.empty}>
                <Icon
                  name="information-outline"
                  size={20}
                  color={Colors.secondaryText}
                />
                <Text style={styles.emptyText}>
                  No completed trips recorded today yet. Your impact updates as
                  trips finish.
                </Text>
              </View>
            </GlassCard>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const Metric: React.FC<{
  icon: string;
  color: string;
  value: string;
  label: string;
}> = ({ icon, color, value, label }) => (
  <GlassCard cornerRadius={14} style={styles.metricCard}>
    <View style={styles.metricContent}>
      <Icon name={icon} size={20} color={color} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  </GlassCard>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  hero: { alignItems: "center", padding: 24, gap: 8 },
  heroIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "rgba(57,255,20,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroValue: {
    fontSize: 38,
    fontWeight: "900",
    color: Colors.neonGreen,
    marginTop: 6,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1.5,
  },
  heroNote: { fontSize: 12, color: Colors.secondaryText },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { width: "47%", flexGrow: 1 },
  metricContent: { padding: 16, gap: 6 },
  metricValue: { fontSize: 20, fontWeight: "900", color: Colors.white },
  metricLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
  },
  empty: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  emptyText: {
    flex: 1,
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 17,
  },
  loadWarning: { color: Colors.trickeeYellow, fontSize: 13, lineHeight: 18, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,202,32,0.08)" },
});

export default DailyImpactScreen;
