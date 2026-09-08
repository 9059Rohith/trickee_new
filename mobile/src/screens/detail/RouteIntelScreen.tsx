import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../constants/Colors";
import DetailHeader from "../../components/DetailHeader";
import GlassCard from "../../components/GlassCard";
import BackgroundLogo from "../../components/BackgroundLogo";
import { LoadingState, EmptyState } from "../../components/StateViews";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api } from "../../services/api";
import type { ChargerRecommendation } from "../../services/types";
import { buildDirectionsUrl } from "../../services/mapNavigation";
import { estimateLiveSoc } from "../../services/liveSoc";

const haversineKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) => {
  const radiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const fmt = (v: number | null | undefined, d = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "--";

const RouteIntelScreen: React.FC = () => {
  const { token } = useAuth();
  const { me, driver, vehicle, telemetry, gpsSummary, latestSoc, liveState } = useLiveData();
  const [rec, setRec] = useState<ChargerRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const liveSoc = me?.active_trip
    ? estimateLiveSoc({
        startingSocPct: me.active_trip.starting_soc,
        distanceKm: liveState?.distance_km,
        usableKwh: vehicle?.usable_kwh,
        whPerKm: gpsSummary?.latest_prediction?.wh_per_km,
      })
    : null;
  const soc = liveSoc ?? (gpsSummary?.soc?.is_recent ? latestSoc : null);
  const range =
    soc != null && vehicle?.usable_kwh && gpsSummary?.latest_prediction?.wh_per_km
      ? (soc * vehicle.usable_kwh * 10) / gpsSummary.latest_prediction.wh_per_km
      : null;
  const destination =
    me?.active_trip?.destination_lat != null && me.active_trip.destination_lng != null
      ? { lat: me.active_trip.destination_lat, lng: me.active_trip.destination_lng }
      : null;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (
        !token ||
        !driver ||
        !vehicle ||
        telemetry?.lat == null ||
        telemetry?.lng == null
      ) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await api.recommendChargers(
          token,
          {
            driver_id: driver.id,
            vehicle_id: vehicle.id,
            lat: telemetry.lat,
            lng: telemetry.lng,
            soc,
            destination_km: destination
              ? Math.min(
                  haversineKm(
                    { lat: telemetry.lat, lng: telemetry.lng },
                    destination
                  ),
                  500
                )
              : 10,
            available_time_min: 30,
          },
          signal
        );
        setRec(result);
      } catch {
        if (!signal?.aborted) {
          setError("Could not load route intelligence.");
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, driver?.id, vehicle?.id, telemetry?.lat, telemetry?.lng, soc, destination?.lat, destination?.lng]
  );

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  const best = rec?.recommended_charger ?? null;
  const lowBattery = soc != null && soc < 25;
  const advice = rec?.charge_advice;

  const openDirections = async (lat?: number | null, lng?: number | null, label?: string | null) => {
    const url = buildDirectionsUrl({ lat, lng, label });
    if (!url) {
      setError("This charger has no valid map coordinates.");
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setError("Google Maps could not be opened on this phone.");
    }
  };

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader title="Route Intel" subtitle="Range & charging guidance" />
      {loading ? (
        <LoadingState label="Analyzing route…" />
      ) : !vehicle ? (
        <EmptyState
          icon="map-marker-off"
          title="No vehicle linked"
          subtitle="Route intelligence needs an assigned vehicle."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Range summary */}
          <GlassCard cornerRadius={18}>
            <View style={styles.rangeRow}>
              <View style={styles.rangeStat}>
                <Text style={styles.rangeValue}>{fmt(soc)}%</Text>
                <Text style={styles.rangeLabel}>STATE OF CHARGE</Text>
              </View>
              <View style={styles.rangeDivider} />
              <View style={styles.rangeStat}>
                <Text style={[styles.rangeValue, styles.healthyRangeValue]}>
                  {fmt(range)} km
                </Text>
                <Text style={styles.rangeLabel}>ESTIMATED RANGE</Text>
              </View>
            </View>
            <View
              style={[
                styles.banner,
                lowBattery ? styles.lowBatteryBanner : styles.healthyBanner,
              ]}
            >
              <Icon
                name={lowBattery ? "battery-alert" : "check-circle"}
                size={16}
                color={lowBattery ? Colors.redSoft : Colors.neonGreen}
              />
              <Text style={styles.bannerText}>
                {soc == null
                  ? "Add a current SOC to receive charging guidance."
                  : advice === "charge_now"
                  ? "Charge now — the route estimate is below the reserve threshold."
                  : advice === "plan_charging"
                  ? "Plan a charging stop before completing the route."
                  : lowBattery
                  ? "Battery is low — plan a charging stop soon."
                  : "The current estimate does not require a charging stop."}
              </Text>
            </View>
          </GlassCard>

          {/* Recommendation */}
          <View style={styles.sectionHeader}>
            <Icon name="ev-station" size={14} color={Colors.trickeeYellow} />
            <Text style={styles.sectionLabel}>RECOMMENDED CHARGER</Text>
          </View>

          {error ? (
            <GlassCard cornerRadius={16}>
              <EmptyState
                icon="cloud-alert"
                title="Unavailable"
                subtitle={error}
              />
            </GlassCard>
          ) : best ? (
            <GlassCard cornerRadius={16}>
              <View style={styles.recContent}>
                <View style={styles.recTop}>
                  <View style={styles.recIcon}>
                    <Icon
                      name="ev-station"
                      size={22}
                      color={Colors.neonGreen}
                    />
                  </View>
                  <View style={styles.recBody}>
                    <Text style={styles.recName}>{best.name || "Charger"}</Text>
                    <Text style={styles.recMeta}>
                      {best.distance_km != null
                        ? `${best.distance_km.toFixed(1)} km away`
                        : ""}
                      {best.charger_type ? ` · ${best.charger_type}` : ""}
                    </Text>
                  </View>
                  {best.estimated_soc_gain != null && (
                    <View style={styles.gainPill}>
                      <Text style={styles.gainText}>
                        +{best.estimated_soc_gain}%
                      </Text>
                    </View>
                  )}
                </View>
                {rec?.reason ? (
                  <Text style={styles.reason}>{rec.reason}</Text>
                ) : null}
                <Text style={styles.source}>
                  Source: {best.provider_source || rec?.provider_source || "not provided"}. Live connector availability is not claimed.
                </Text>
                <TouchableOpacity
                  style={styles.mapButton}
                  onPress={() => openDirections(best.lat, best.lng, best.name)}
                >
                  <Text style={styles.mapButtonText}>Open directions</Text>
                </TouchableOpacity>
              </View>
            </GlassCard>
          ) : (
            <GlassCard cornerRadius={16}>
              <EmptyState
                icon="power-plug-off"
                title="No charger recommendation"
                subtitle="No charger context is available for your current location."
              />
            </GlassCard>
          )}

          {/* Alternatives */}
          {rec && rec.alternatives.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Icon
                  name="format-list-bulleted"
                  size={14}
                  color={Colors.trickeeYellow}
                />
                <Text style={styles.sectionLabel}>ALTERNATIVES</Text>
              </View>
              {rec.alternatives.map((c, i) => (
                <GlassCard
                  key={`${c.name}-${i}`}
                  cornerRadius={14}
                  style={styles.altCard}
                >
                  <View style={styles.altRow}>
                    <Icon name="ev-station" size={18} color={Colors.neonBlue} />
                    <Text style={styles.altName}>{c.name || "Charger"}</Text>
                    <Text style={styles.altDist}>
                      {c.distance_km != null
                        ? `${c.distance_km.toFixed(1)} km`
                        : "--"}
                    </Text>
                    <TouchableOpacity onPress={() => openDirections(c.lat, c.lng, c.name)}>
                      <Icon name="directions" size={20} color={Colors.trickeeYellow} />
                    </TouchableOpacity>
                  </View>
                </GlassCard>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  rangeRow: { flexDirection: "row", padding: 18, alignItems: "center" },
  rangeStat: { flex: 1, alignItems: "center", gap: 4 },
  rangeValue: { fontSize: 30, fontWeight: "900", color: Colors.trickeeYellow },
  healthyRangeValue: { color: Colors.neonGreen },
  rangeLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 1,
  },
  rangeDivider: {
    width: 1,
    height: 44,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
  },
  lowBatteryBanner: { backgroundColor: "rgba(255,68,68,0.1)" },
  healthyBanner: { backgroundColor: "rgba(57,255,20,0.08)" },
  bannerText: {
    flex: 1,
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    lineHeight: 17,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1,
  },
  recContent: { padding: 16, gap: 12 },
  recTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  recBody: { flex: 1 },
  recIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(57,255,20,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  recName: { fontSize: 16, fontWeight: "700", color: Colors.white },
  recMeta: { fontSize: 12, color: Colors.secondaryText, marginTop: 2 },
  gainPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "rgba(57,255,20,0.12)",
  },
  gainText: { fontSize: 13, fontWeight: "800", color: Colors.neonGreen },
  reason: { fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 19 },
  source: { fontSize: 11, color: Colors.secondaryText, lineHeight: 16 },
  mapButton: {
    alignSelf: "flex-start",
    borderColor: Colors.trickeeYellow,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapButtonText: { color: Colors.trickeeYellow, fontSize: 12, fontWeight: "800" },
  altCard: { marginBottom: 2 },
  altRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  altName: { flex: 1, fontSize: 14, fontWeight: "600", color: Colors.white },
  altDist: { fontSize: 13, fontWeight: "700", color: Colors.trickeeYellow },
});

export default RouteIntelScreen;
