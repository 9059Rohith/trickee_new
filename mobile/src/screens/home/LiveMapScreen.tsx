import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../constants/Colors";
import GlassCard from "../../components/GlassCard";
import BackgroundLogo from "../../components/BackgroundLogo";
import BatteryVisualizer from "../../components/BatteryVisualizer";
import OpenStreetMap from "../../components/OpenStreetMap";
import { EmptyState } from "../../components/StateViews";
import { useLiveData } from "../../context/LiveDataContext";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { DEFAULT_MAP_CENTER } from "../../config";
import type { ChargerOption } from "../../services/types";

const FilterPill: React.FC<{
  title: string;
  icon: string;
  isOn: boolean;
  activeColor: string;
  onToggle: () => void;
}> = ({ title, icon, isOn, activeColor, onToggle }) => (
  <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
    <View
      style={[
        filterStyles.pill,
        isOn && {
          backgroundColor: `${activeColor}20`,
          borderColor: `${activeColor}60`,
        },
      ]}
    >
      <Icon
        name={icon}
        size={13}
        color={isOn ? activeColor : "rgba(255,255,255,0.5)"}
      />
      <Text style={[filterStyles.pillText, isOn && { color: activeColor }]}>
        {title}
      </Text>
    </View>
  </TouchableOpacity>
);

const filterStyles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  pillText: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
});

/** Rough straight-line distance in km (for the charger request hint only). */
const haversineKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const isFast = (c: ChargerOption) =>
  (c.charger_type || "").toLowerCase().includes("fast");

const LiveMapScreen: React.FC = () => {
  const { token } = useAuth();
  const {
    me,
    telemetry,
    vehicle,
    driver,
    gpsSummary,
    latestSoc,
    refreshing,
    refresh,
  } = useLiveData();

  const [filterFast, setFilterFast] = useState(false);
  const [filterNormal, setFilterNormal] = useState(false);
  const [filterAvailable, setFilterAvailable] = useState(false);
  const [filterSafeRoute, setFilterSafeRoute] = useState(false);

  const [chargers, setChargers] = useState<ChargerOption[]>([]);
  const [chargerReason, setChargerReason] = useState<string | null>(null);
  const [chargersLoading, setChargersLoading] = useState(false);
  const [chargersError, setChargersError] = useState<string | null>(null);

  const vehicleLat = telemetry?.lat ?? DEFAULT_MAP_CENTER.latitude;
  const vehicleLng = telemetry?.lng ?? DEFAULT_MAP_CENTER.longitude;
  const vehicleCode = vehicle?.vehicle_code || "No vehicle";
  const soc = gpsSummary?.soc?.is_recent ? latestSoc : null;
  const range = gpsSummary?.soc?.is_recent
    ? gpsSummary.estimated_range_km ?? null
    : null;
  const speed = telemetry?.speed ?? 0;
  const activeTrip = me?.active_trip ?? null;

  const dest = useMemo(
    () =>
      activeTrip?.destination_lat != null && activeTrip?.destination_lng != null
        ? {
            lat: activeTrip.destination_lat,
            lng: activeTrip.destination_lng,
            label: activeTrip.destination_text || "Destination",
          }
        : null,
    [
      activeTrip?.destination_lat,
      activeTrip?.destination_lng,
      activeTrip?.destination_text,
    ]
  );

  const loadChargers = useCallback(
    async (signal?: AbortSignal) => {
      if (
        !token ||
        !driver ||
        !vehicle ||
        telemetry?.lat == null ||
        telemetry?.lng == null
      ) {
        setChargers([]);
        return;
      }
      setChargersLoading(true);
      setChargersError(null);
      try {
        const destinationKm = dest
          ? haversineKm(
              { lat: vehicleLat, lng: vehicleLng },
              { lat: dest.lat, lng: dest.lng }
            )
          : 10;
        const result = await api.recommendChargers(
          token,
          {
            driver_id: driver.id,
            vehicle_id: vehicle.id,
            lat: vehicleLat,
            lng: vehicleLng,
            soc: soc ?? 0,
            destination_km: Math.min(destinationKm, 500),
            available_time_min: 30,
          },
          signal
        );
        const list = [
          ...(result.recommended_charger ? [result.recommended_charger] : []),
          ...result.alternatives,
        ];
        setChargers(list);
        setChargerReason(result.reason);
      } catch (err) {
        if (!signal?.aborted) {
          setChargersError("Could not load charger recommendations.");
        }
      } finally {
        if (!signal?.aborted) {
          setChargersLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      token,
      driver?.id,
      vehicle?.id,
      telemetry?.lat,
      telemetry?.lng,
      soc,
      dest?.lat,
      dest?.lng,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadChargers(controller.signal);
    return () => controller.abort();
  }, [loadChargers]);

  // Apply filters to the charger list.
  const visibleChargers = useMemo(() => {
    let list = chargers;
    if (filterFast && !filterNormal) {
      list = list.filter(isFast);
    } else if (filterNormal && !filterFast) {
      list = list.filter((c) => !isFast(c));
    }
    if (filterAvailable) {
      list = list.filter((c) => c.availability_confirmed);
    }
    return list;
  }, [chargers, filterFast, filterNormal, filterAvailable]);

  const markers = useMemo(() => {
    const list: Array<{
      id: string;
      latitude: number;
      longitude: number;
      title: string;
      color: string;
      icon: "car" | "charger" | "user" | "destination";
    }> = [
      {
        id: "vehicle-1",
        latitude: vehicleLat,
        longitude: vehicleLng,
        title: vehicleCode,
        color: Colors.trickeeYellow,
        icon: "car",
      },
    ];
    if (dest) {
      list.push({
        id: "destination",
        latitude: dest.lat,
        longitude: dest.lng,
        title: dest.label,
        color: Colors.neonGreen,
        icon: "destination",
      });
    }
    visibleChargers.forEach((c, i) => {
      if (c.lat != null && c.lng != null) {
        list.push({
          id: `charger-${i}`,
          latitude: c.lat,
          longitude: c.lng,
          title: c.name || "Charger",
          color: isFast(c) ? Colors.neonPurple : Colors.neonBlue,
          icon: "charger",
        });
      }
    });
    return list;
  }, [vehicleLat, vehicleLng, vehicleCode, dest, visibleChargers]);

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={Colors.trickeeYellow}
            colors={[Colors.trickeeYellow]}
          />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <FilterPill
            title="Fast Chargers"
            icon="lightning-bolt"
            isOn={filterFast}
            activeColor={Colors.neonPurple}
            onToggle={() => setFilterFast((v) => !v)}
          />
          <FilterPill
            title="Normal Chargers"
            icon="ev-station"
            isOn={filterNormal}
            activeColor={Colors.neonBlue}
            onToggle={() => setFilterNormal((v) => !v)}
          />
          <FilterPill
            title="Available Now"
            icon="check-circle"
            isOn={filterAvailable}
            activeColor={Colors.neonGreen}
            onToggle={() => setFilterAvailable((v) => !v)}
          />
          <FilterPill
            title="Safe Route"
            icon="shield"
            isOn={filterSafeRoute}
            activeColor={Colors.trickeeYellow}
            onToggle={() => setFilterSafeRoute((v) => !v)}
          />
        </ScrollView>

        <OpenStreetMap
          initialLatitude={vehicleLat}
          initialLongitude={vehicleLng}
          initialZoom={14}
          markers={markers}
          height={300}
          borderRadius={20}
        />

        {/* HUD */}
        <GlassCard
          style={styles.hudCard}
          cornerRadius={20}
          variant="liquidGlass"
          highlightColor="rgba(255, 202, 32, 0.08)"
        >
          <View style={styles.hudContent}>
            <View style={styles.hudTopRow}>
              <View>
                <View style={styles.hudPlateRow}>
                  <Text style={styles.hudPlateText}>{vehicleCode}</Text>
                  <View style={styles.hudMovingBadge}>
                    <Text style={styles.hudMovingText}>
                      {telemetry?.ignition_on ? "MOVING" : "IDLE"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.hudSubText}>
                  {driver?.full_name || "Driver not loaded"}
                </Text>
              </View>
            </View>

            <View style={styles.hudStatsRow}>
              <View style={styles.hudStat}>
                <Text style={styles.hudStatLabel}>STATE OF CHARGE</Text>
                <View style={styles.hudSocRow}>
                  <Text style={styles.hudSocValue}>
                    {soc != null ? `${soc.toFixed(1)}%` : "Need SOC"}
                  </Text>
                  {soc != null && <BatteryVisualizer soc={soc} />}
                </View>
              </View>
              <View style={styles.hudStat}>
                <Text style={styles.hudStatLabel}>EST. RANGE</Text>
                <Text style={styles.hudStatValue}>
                  {range != null ? `${range.toFixed(1)} km` : "Need SOC"}
                </Text>
              </View>
              <View style={styles.hudStat}>
                <Text style={styles.hudStatLabel}>SPEED</Text>
                <Text style={styles.hudStatValue}>{speed.toFixed(1)} km/h</Text>
              </View>
            </View>

            <View style={styles.hudDivider} />

            <View style={styles.hudDestRow}>
              <Icon
                name={filterSafeRoute ? "shield" : "map-marker-circle"}
                size={16}
                color={
                  filterSafeRoute ? Colors.neonGreen : Colors.trickeeYellow
                }
              />
              <Text style={styles.hudDestText}>
                {dest
                  ? filterSafeRoute
                    ? `Safe route to ${dest.label}`
                    : `Heading to ${dest.label}`
                  : "No active destination"}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Nearby chargers — real recommendations */}
        <View style={styles.sectionHeader}>
          <Icon name="ev-station" size={14} color={Colors.trickeeYellow} />
          <Text style={styles.sectionLabel}>NEARBY CHARGERS</Text>
          {chargersLoading && (
            <ActivityIndicator
              size="small"
              color={Colors.trickeeYellow}
              style={styles.chargerSpinner}
            />
          )}
        </View>

        {chargerReason && visibleChargers.length > 0 && (
          <Text style={styles.reasonText}>{chargerReason}</Text>
        )}

        {visibleChargers.length === 0 && !chargersLoading ? (
          <GlassCard cornerRadius={16}>
            <EmptyState
              icon="power-plug-off"
              title={
                chargersError ? "Charger data unavailable" : "No chargers match"
              }
              subtitle={
                chargersError ||
                (chargers.length === 0
                  ? "No charger recommendations for this location yet."
                  : "Adjust the filters to see more options.")
              }
            />
          </GlassCard>
        ) : (
          visibleChargers.map((c, i) => (
            <GlassCard
              key={`${c.name}-${i}`}
              style={styles.chargerCard}
              cornerRadius={16}
            >
              <View style={styles.chargerContent}>
                <View style={styles.chargerRow}>
                  <View
                    style={[
                      styles.chargerIcon,
                      !isFast(c) && styles.blueCharger,
                    ]}
                  >
                    <Icon
                      name="ev-station"
                      size={20}
                      color={isFast(c) ? Colors.neonPurple : Colors.neonBlue}
                    />
                  </View>
                  <View style={styles.chargerInfo}>
                    <Text style={styles.chargerName}>
                      {c.name || "Charger"}
                    </Text>
                    <Text style={styles.chargerAddress}>
                      {isFast(c) ? "DC Fast charger" : "AC charger"}
                    </Text>
                  </View>
                  <View style={styles.chargerMeta}>
                    <Text style={styles.chargerDistance}>
                      {c.distance_km != null
                        ? `${c.distance_km.toFixed(1)} km`
                        : "--"}
                    </Text>
                    <View
                      style={[
                        styles.availableBadge,
                        !c.availability_confirmed && styles.busyBadge,
                      ]}
                    >
                      <Text
                        style={[
                          styles.availableText,
                          !c.availability_confirmed && styles.busyText,
                        ]}
                      >
                        {c.availability_confirmed ? "AVAILABLE" : "UNCONFIRMED"}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.chargerStats}>
                  <View style={styles.chargerStat}>
                    <Text style={styles.statLabel}>Type</Text>
                    <Text style={styles.statValue}>
                      {isFast(c) ? "DC Fast" : "AC"}
                    </Text>
                  </View>
                  <View style={styles.chargerStat}>
                    <Text style={styles.statLabel}>Est. gain</Text>
                    <Text style={styles.statValue}>
                      {c.estimated_soc_gain != null
                        ? `+${c.estimated_soc_gain}%`
                        : "--"}
                    </Text>
                  </View>
                  <View style={styles.chargerStat}>
                    <Text style={styles.statLabel}>Rating</Text>
                    <Text style={styles.statValue}>
                      {c.rating != null ? c.rating.toFixed(1) : "--"}
                    </Text>
                  </View>
                </View>
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  watermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0,
  },
  watermarkImage: { width: "100%", height: "100%", opacity: 0.15 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 160,
    gap: 14,
  },
  filterRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  hudCard: { marginTop: -4 },
  hudContent: { padding: 18, gap: 14 },
  hudTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  hudPlateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hudPlateText: { fontSize: 18, fontWeight: "700", color: Colors.white },
  hudMovingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(57, 255, 20, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(57, 255, 20, 0.4)",
  },
  hudMovingText: { fontSize: 9, fontWeight: "700", color: Colors.neonGreen },
  hudSubText: { fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 },
  hudStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  hudStat: { gap: 4 },
  hudStatLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
  },
  hudSocRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hudSocValue: { fontSize: 24, fontWeight: "900", color: Colors.trickeeYellow },
  hudStatValue: { fontSize: 20, fontWeight: "700", color: Colors.white },
  hudDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  hudDestRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hudDestText: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255,255,255,0.7)",
    flex: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
    marginTop: 6,
  },
  chargerSpinner: { marginLeft: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1,
  },
  reasonText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 17,
    paddingHorizontal: 4,
    fontStyle: "italic",
  },
  chargerCard: {},
  chargerContent: { padding: 16, gap: 12 },
  chargerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  chargerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(189, 0, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  blueCharger: { backgroundColor: "rgba(0, 229, 255, 0.1)" },
  chargerInfo: { flex: 1, gap: 2 },
  chargerName: { fontSize: 14, fontWeight: "700", color: Colors.white },
  chargerAddress: { fontSize: 12, color: Colors.secondaryText },
  chargerMeta: { alignItems: "flex-end", gap: 4 },
  chargerDistance: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.trickeeYellow,
  },
  availableBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(57, 255, 20, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(57, 255, 20, 0.3)",
  },
  availableText: { fontSize: 8, fontWeight: "700", color: Colors.neonGreen },
  busyBadge: {
    backgroundColor: "rgba(255, 204, 0, 0.1)",
    borderColor: "rgba(255, 204, 0, 0.3)",
  },
  busyText: { color: Colors.moderateYellow },
  chargerStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    paddingVertical: 10,
  },
  chargerStat: { alignItems: "center", gap: 4 },
  statLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.4)",
  },
  statValue: { fontSize: 13, fontWeight: "700", color: Colors.white },
});

export default LiveMapScreen;
