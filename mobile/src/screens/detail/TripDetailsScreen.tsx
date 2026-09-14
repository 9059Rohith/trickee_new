import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import BackgroundLogo from "../../components/BackgroundLogo";
import DetailHeader from "../../components/DetailHeader";
import OpenStreetMap, { type MapMarker } from "../../components/OpenStreetMap";
import { ErrorState, LoadingState } from "../../components/StateViews";
import { Colors } from "../../constants/Colors";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../services/api";
import { selectedTripPolylines, socUsedLabel, tripDurationLabel } from "../../services/tripHistory";
import type { TripDayDetail, TripDayResponse } from "../../services/types";

const fmt = (value: number | null | undefined, digits = 1) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "Unavailable";
const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Unavailable";

const EvidenceRow: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => <View style={styles.evidenceRow}><Text style={styles.evidenceLabel}>{label}</Text><Text style={[styles.evidenceValue, accent && styles.accent]}>{value}</Text></View>;

const TripSummary: React.FC<{ trip: TripDayDetail; number: number }> = ({ trip, number }) => {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const label = trip.energy_label;
  const prediction = trip.prediction;
  const eventTotal = Object.values(trip.events.by_type).reduce((sum, count) => sum + count, 0);
  return <View style={styles.summaryCard}>
    <Text style={styles.summaryTitle}>Trip {number} · {time(trip.started_at)}–{time(trip.ended_at)}</Text>
    <EvidenceRow label="Duration" value={tripDurationLabel(trip.started_at, trip.ended_at)} />
    <EvidenceRow label="Distance" value={`${fmt(trip.features?.distance_km)} km`} />
    <EvidenceRow label="SOC start → end" value={label ? `${fmt(label.starting_soc_pct)}% → ${fmt(label.ending_soc_pct)}%` : "Unavailable"} />
    <EvidenceRow label="SOC used" value={socUsedLabel(label?.starting_soc_pct, label?.ending_soc_pct, label?.eligibility_reason)} />
    <EvidenceRow label="Actual energy" value={label?.actual_energy_consumed_wh == null ? "Unavailable" : `${fmt(label.actual_energy_consumed_wh, 0)} Wh · ${fmt(label.actual_wh_per_km, 2)} Wh/km`} accent={!!label} />
    <EvidenceRow label="Estimated energy" value={prediction?.route_energy_wh == null ? "Unavailable" : `${fmt(prediction.route_energy_wh, 0)} Wh · ${prediction.source || "unknown source"}`} />
    <TouchableOpacity
      testID={`trip-${trip.id}-evidence-toggle`}
      accessibilityRole="button"
      accessibilityLabel={evidenceOpen ? "Hide trip data quality" : "Show trip data quality"}
      accessibilityState={{ expanded: evidenceOpen }}
      style={styles.evidenceToggle}
      onPress={() => setEvidenceOpen(open => !open)}
    >
      <Text style={styles.evidenceToggleText}>{evidenceOpen ? "Hide data quality" : "Show data quality"}</Text>
    </TouchableOpacity>
    {evidenceOpen ? <View style={styles.technicalSection}>
      <EvidenceRow label="Status" value={trip.status} />
      <EvidenceRow label="Average / max speed" value={`${fmt(trip.features?.avg_speed_kmh)} / ${fmt(trip.features?.max_speed_kmh)} km/h`} />
      <EvidenceRow label="Stops / dwell" value={`${trip.features?.stops_count ?? "Unavailable"} / ${fmt(trip.features?.total_dwell_minutes)} min`} />
      <EvidenceRow label="GPS stored / final" value={`${trip.telemetry_quality.stored_windows} / ${trip.telemetry_quality.final_windows ?? "Unknown"}`} />
      <EvidenceRow label="GPS missing / complete" value={`${trip.telemetry_quality.actual_missing_windows ?? "Unknown"} / ${fmt(trip.telemetry_quality.completeness_pct, 2)}%`} />
      <EvidenceRow label="Finalization" value={trip.finalization?.state || "Not finalized"} />
      <EvidenceRow label="Training label" value={label ? `${label.is_training_eligible ? "Eligible" : "Not eligible"} · ${label.eligibility_reason}` : "Pending or unavailable"} accent={label?.is_training_eligible} />
      <EvidenceRow label="Recorded events" value={`${eventTotal} · ${Object.entries(trip.events.by_severity).map(([key, value]) => `${key} ${value}`).join(", ") || "none"}`} />
    </View> : null}
    {!trip.route_trace_available ? <Text style={styles.warning}>Route trace is no longer available. The summary remains authoritative.</Text> : null}
  </View>;
};

const TripDetailsScreen: React.FC<{ route: any }> = ({ route }) => {
  const { driverId, serviceDate, selectedTripId: initialTripId } = route.params;
  const { token } = useAuth();
  const [day, setDay] = useState<TripDayResponse | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(initialTripId || null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    if (!token) return;
    refresh ? setRefreshing(true) : setLoading(true);
    try { setDay(await api.driverTripDay(token, driverId, serviceDate, "Asia/Kolkata", signal)); setError(null); }
    catch (caught) { if (!signal?.aborted) setError(caught instanceof ApiError ? caught.message : "Could not load trip evidence."); }
    finally { if (!signal?.aborted) { setLoading(false); setRefreshing(false); } }
  }, [token, driverId, serviceDate]);

  useEffect(() => { const controller = new AbortController(); load(false, controller.signal); return () => controller.abort(); }, [load]);
  const visibleTrips = useMemo(() => day?.trips.filter(trip => !selectedTripId || trip.id === selectedTripId) || [], [day, selectedTripId]);
  const polylines = useMemo(() => selectedTripPolylines(day?.trips || [], selectedTripId), [day, selectedTripId]);
  const markers = useMemo<MapMarker[]>(() => visibleTrips.flatMap((trip, index) => {
    const points = trip.route_points;
    if (!points.length) return [];
    return [
      { id: `${trip.id}-start`, latitude: points[0].latitude, longitude: points[0].longitude, title: `Trip ${index + 1} start`, color: "#39ff14", icon: "user" as const },
      { id: `${trip.id}-end`, latitude: points[points.length - 1].latitude, longitude: points[points.length - 1].longitude, title: `Trip ${index + 1} end`, color: "#ffca20", icon: "destination" as const },
    ];
  }), [visibleTrips]);
  const center = polylines[0]?.points[0] || { latitude: 21.1702, longitude: 72.8311 };

  if (loading) return <View style={styles.container}><DetailHeader title="Trip details" /><LoadingState label="Loading recorded route…" /></View>;
  if (error) return <View style={styles.container}><DetailHeader title="Trip details" /><ErrorState message={error} onRetry={() => load()} /></View>;
  return <View style={styles.container}><BackgroundLogo /><DetailHeader title="Trip details" subtitle={`${serviceDate} · recorded evidence`} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.trickeeYellow} colors={[Colors.trickeeYellow]} />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <TouchableOpacity style={[styles.chip, selectedTripId === null && styles.chipActive]} onPress={() => setSelectedTripId(null)}><Text style={[styles.chipText, selectedTripId === null && styles.chipTextActive]}>All day</Text></TouchableOpacity>
        {day?.trips.map((trip, index) => <TouchableOpacity key={trip.id} style={[styles.chip, selectedTripId === trip.id && styles.chipActive]} onPress={() => setSelectedTripId(trip.id)}><Text style={[styles.chipText, selectedTripId === trip.id && styles.chipTextActive]}>Trip {index + 1}</Text></TouchableOpacity>)}
      </ScrollView>
      {polylines.length ? <OpenStreetMap initialLatitude={center.latitude} initialLongitude={center.longitude} initialZoom={13} markers={markers} polylines={polylines} fitBoundsOnUpdate height={330} /> : <View style={styles.noMap}><Text style={styles.warning}>Route trace is no longer available for this selection.</Text></View>}
      {visibleTrips.map(trip => <TripSummary key={trip.id} trip={trip} number={(day?.trips.findIndex(item => item.id === trip.id) ?? 0) + 1} />)}
      {!day?.trips.length ? <View style={styles.noMap}><Text style={styles.warning}>No trips were recorded on this day.</Text></View> : null}
    </ScrollView>
  </View>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground }, content: { padding: 16, gap: 14, paddingBottom: 48 }, chips: { gap: 8 },
  chip: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: Colors.premiumCardBorder, backgroundColor: Colors.premiumCardBg }, chipActive: { backgroundColor: Colors.trickeeYellow }, chipText: { color: Colors.white, fontWeight: "800" }, chipTextActive: { color: Colors.darkText },
  noMap: { minHeight: 120, borderRadius: 16, borderWidth: 1, borderColor: Colors.premiumCardBorder, backgroundColor: Colors.premiumCardBg, alignItems: "center", justifyContent: "center", padding: 20 },
  summaryCard: { backgroundColor: Colors.premiumCardBg, borderColor: Colors.premiumCardBorder, borderWidth: 1, borderRadius: 16, padding: 15, gap: 9 }, summaryTitle: { color: Colors.white, fontWeight: "900", fontSize: 16, marginBottom: 4 },
  evidenceToggle: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: Colors.premiumCardBorder, marginTop: 4 }, evidenceToggleText: { color: Colors.neonBlue, fontSize: 14, fontWeight: "900" }, technicalSection: { gap: 9, borderTopWidth: 1, borderTopColor: Colors.premiumCardBorder, paddingTop: 11 },
  evidenceRow: { flexDirection: "row", gap: 12 }, evidenceLabel: { flex: 1, color: Colors.secondaryText, fontSize: 12 }, evidenceValue: { flex: 1.4, color: Colors.white, fontSize: 12, fontWeight: "700", textAlign: "right" }, accent: { color: Colors.greenAccent }, warning: { color: Colors.trickeeYellow, lineHeight: 18, textAlign: "center" },
});

export default TripDetailsScreen;
