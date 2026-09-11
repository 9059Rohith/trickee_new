import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
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
import { localServiceDate } from "../../services/tripHistory";

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

const TripCard: React.FC<{
  trip: Trip;
  onOpen: (trip: Trip) => void;
}> = ({ trip, onOpen }) => {
  const dur = durationLabel(trip.started_at, trip.ended_at);
  const socDelta =
    trip.soc_start != null && trip.soc_end != null
      ? trip.soc_start - trip.soc_end
      : null;

  return (
    <TouchableOpacity
      testID={`past-trip-${trip.id}`}
      accessibilityRole="button"
      accessibilityLabel={`View trip from ${dateLabel(trip.started_at)}`}
      accessibilityHint="Opens the recorded route and trip summary"
      activeOpacity={0.82}
      onPress={() => onOpen(trip)}
    >
      <GlassCard cornerRadius={16} style={styles.card}>
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Icon name="map-marker-path" size={18} color={Colors.trickeeYellow} />
            <Text style={styles.cardDate}>{dateLabel(trip.started_at)}</Text>
            {trip.ended_at ? null : <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>ONGOING</Text></View>}
          </View>
          {(trip.origin_label || trip.dest_label) && <Text style={styles.route}>{trip.origin_label || "Origin"} → {trip.dest_label || "Destination"}</Text>}
          <View style={styles.statsRow}>
            <Stat label="Distance" value={trip.distance_km == null ? "Unavailable" : `${fmt(trip.distance_km)} km`} />
            <Stat label="Energy" value={trip.kwh_used == null ? "Unavailable" : `${fmt(trip.kwh_used, 2)} kWh`} />
            <Stat label="SOC used" value={socDelta != null ? `${fmt(socDelta)}%` : "Unavailable"} />
            <Stat label="Duration" value={dur || "Unavailable"} />
          </View>
          <View style={styles.openRow}><Text style={styles.openText}>View route & summary</Text><Icon name="chevron-right" size={20} color={Colors.trickeeYellow} /></View>
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
};

const TripSeparator = () => <View style={styles.separator} />;

const PastTripsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
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

  const openTrip = useCallback(
    (trip: Trip) => {
      if (!driver || !trip.started_at) {
        return;
      }
      navigation.navigate("TripDetails", {
        driverId: driver.id,
        serviceDate: localServiceDate(trip.started_at),
        selectedTripId: trip.id,
      });
    },
    [driver, navigation]
  );

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader title="Past Trips" subtitle={driver?.full_name} />
      {loading ? (
        <LoadingState label="Loading trips…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load("initial")} />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={trip => trip.id}
          renderItem={({ item }) => (
            <TripCard trip={item} onOpen={openTrip} />
          )}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={TripSeparator}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={() => load("refresh")}
          ListHeaderComponent={<Text style={styles.resultCount}>Latest {trips.length} trip{trips.length === 1 ? "" : "s"}</Text>}
          ListEmptyComponent={<GlassCard cornerRadius={16}><EmptyState icon="map-marker-path" title="No trips recorded yet" subtitle="Completed trips will appear here once you start driving with the app." /></GlassCard>}
        />
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
  separator: { height: 12 },
  resultCount: { color: Colors.secondaryText, fontSize: 13, marginBottom: 12 },
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
  liveBadgeText: { fontSize: 12, fontWeight: "700", color: Colors.neonGreen },
  route: { fontSize: 14, color: "rgba(255,255,255,0.72)" },
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
  statLabel: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.58)" },
  openRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 },
  openText: { color: Colors.trickeeYellow, fontWeight: "800", fontSize: 14 },
});

export default PastTripsScreen;
