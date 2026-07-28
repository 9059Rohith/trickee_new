import React, { useCallback, useEffect, useState } from "react";
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
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../../components/StateViews";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api, ApiError } from "../../services/api";
import type { Trip } from "../../services/types";

const fmt = (v: number | null | undefined, d = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "--";

const dateLabel = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : "Unknown time";

const durationLabel = (start?: string | null, end?: string | null) => {
  if (!start || !end) {
    return null;
  }
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const mins = Math.round(ms / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};

const PastTripsScreen: React.FC = () => {
  const { token } = useAuth();
  const { driver } = useLiveData();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const rows = await api.driverTrips(token, driver.id, 50, signal);
        setTrips(rows);
        setError(null);
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof ApiError ? err.message : "Could not load trips."
          );
        }
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

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader title="Past Trips" subtitle={driver?.full_name} />
      {loading ? (
        <LoadingState label="Loading trips…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load("initial")} />
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
          {trips.length === 0 ? (
            <GlassCard cornerRadius={16}>
              <EmptyState
                icon="map-marker-path"
                title="No trips recorded yet"
                subtitle="Completed trips will appear here once you start driving with the app."
              />
            </GlassCard>
          ) : (
            trips.map((trip) => {
              const dur = durationLabel(trip.started_at, trip.ended_at);
              const socDelta =
                trip.soc_start != null && trip.soc_end != null
                  ? trip.soc_start - trip.soc_end
                  : null;
              return (
                <GlassCard key={trip.id} cornerRadius={16} style={styles.card}>
                  <View style={styles.cardContent}>
                    <View style={styles.cardHeader}>
                      <Icon
                        name="map-marker-path"
                        size={18}
                        color={Colors.trickeeYellow}
                      />
                      <Text style={styles.cardDate}>
                        {dateLabel(trip.started_at)}
                      </Text>
                      {trip.ended_at ? null : (
                        <View style={styles.liveBadge}>
                          <Text style={styles.liveBadgeText}>ONGOING</Text>
                        </View>
                      )}
                    </View>
                    {(trip.origin_label || trip.dest_label) && (
                      <Text style={styles.route}>
                        {trip.origin_label || "Origin"} →{" "}
                        {trip.dest_label || "Destination"}
                      </Text>
                    )}
                    <View style={styles.statsRow}>
                      <Stat
                        label="Distance"
                        value={`${fmt(trip.distance_km)} km`}
                      />
                      <Stat
                        label="Energy"
                        value={`${fmt(trip.kwh_used, 2)} kWh`}
                      />
                      <Stat
                        label="SOC used"
                        value={socDelta != null ? `${fmt(socDelta)}%` : "--"}
                      />
                      <Stat label="Duration" value={dur || "--"} />
                    </View>
                  </View>
                </GlassCard>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {},
  cardContent: { padding: 16, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardDate: { flex: 1, fontSize: 13, fontWeight: "700", color: Colors.white },
  liveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(57,255,20,0.12)",
    borderWidth: 1,
    borderColor: "rgba(57,255,20,0.4)",
  },
  liveBadgeText: { fontSize: 8, fontWeight: "700", color: Colors.neonGreen },
  route: { fontSize: 12, color: "rgba(255,255,255,0.6)" },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  stat: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 14, fontWeight: "800", color: Colors.white },
  statLabel: { fontSize: 9, fontWeight: "600", color: "rgba(255,255,255,0.4)" },
});

export default PastTripsScreen;
