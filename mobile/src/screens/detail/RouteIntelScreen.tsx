import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
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

const fmt = (v: number | null | undefined, d = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "--";

const RouteIntelScreen: React.FC = () => {
  const { token } = useAuth();
  const { driver, vehicle, telemetry, gpsSummary, latestSoc } = useLiveData();
  const [rec, setRec] = useState<ChargerRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const soc = gpsSummary?.soc?.is_recent ? latestSoc : null;
  const range = gpsSummary?.soc?.is_recent
    ? gpsSummary.estimated_range_km ?? null
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
            soc: soc ?? 0,
            destination_km: 10,
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
    [token, driver?.id, vehicle?.id, telemetry?.lat, telemetry?.lng, soc]
  );

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  const best = rec?.recommended_charger ?? null;
  const lowBattery = soc != null && soc < 25;

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
                {lowBattery
                  ? "Battery is low — plan a charging stop soon."
                  : "Range is healthy for typical delivery distances."}
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
  altCard: { marginBottom: 2 },
  altRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  altName: { flex: 1, fontSize: 14, fontWeight: "600", color: Colors.white },
  altDist: { fontSize: 13, fontWeight: "700", color: Colors.trickeeYellow },
});

export default RouteIntelScreen;
