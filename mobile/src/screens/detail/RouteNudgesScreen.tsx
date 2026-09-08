import React, { useCallback, useState } from "react";
import {
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Colors } from "../../constants/Colors";
import BackgroundLogo from "../../components/BackgroundLogo";
import DetailHeader from "../../components/DetailHeader";
import RouteNudgeCard from "../../components/RouteNudgeCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { mergeRouteNudges } from "../../services/nudgeInbox";
import {
  enqueueNudgeOutcome,
  flushNudgeOutcomes,
  loadCachedRouteNudges,
  pendingNudgeOutcomeCount,
  saveCachedRouteNudges,
} from "../../services/nudgeStorage";
import type { RouteNudge, RouteNudgeEvent } from "../../services/types";

const RouteNudgesScreen: React.FC = () => {
  const { token } = useAuth();
  const [nudges, setNudges] = useState<RouteNudge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOutcomes, setPendingOutcomes] = useState(0);

  const sendOutcome = useCallback(
    (nudgeId: string, payload: Parameters<typeof api.recordRouteNudgeOutcome>[2]) => {
      if (!token) return Promise.reject(new Error("Authentication unavailable"));
      return api.recordRouteNudgeOutcome(token, nudgeId, payload);
    },
    [token]
  );

  const refresh = useCallback(
    async (showRefresh = false, signal?: AbortSignal) => {
      if (showRefresh) setRefreshing(true);
      setError(null);
      try {
        const cached = await loadCachedRouteNudges();
        if (!signal?.aborted && cached.length) {
          setNudges(cached);
          setLoading(false);
        }
        if (token) {
          await flushNudgeOutcomes(sendOutcome);
          const remote = await api.listRouteNudges(token, 50, signal);
          const merged = mergeRouteNudges(cached, remote);
          await saveCachedRouteNudges(merged);
          if (!signal?.aborted) setNudges(merged);
        }
        if (!signal?.aborted) {
          setPendingOutcomes(await pendingNudgeOutcomeCount());
        }
      } catch {
        if (!signal?.aborted) {
          setError("Could not sync route updates. Cached updates remain available.");
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [sendOutcome, token]
  );

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      refresh(false, controller.signal);
      return () => controller.abort();
    }, [refresh])
  );

  const handleAction = useCallback(
    async (nudge: RouteNudge, event: RouteNudgeEvent) => {
      const selectedRouteId = nudge.payload.selected_route_id || undefined;
      await enqueueNudgeOutcome(nudge.id, event, {
        selected_route_id: selectedRouteId,
        metadata: { source: "gps_driver_inbox" },
      });
      const optimistic = nudges.map((item) =>
        item.id === nudge.id
          ? {
              ...item,
              outcome: {
                ...(item.outcome || {}),
                latest_event: event,
                selected_route_id: selectedRouteId,
              },
            }
          : item
      );
      setNudges(optimistic);
      await saveCachedRouteNudges(optimistic);
      const result = await flushNudgeOutcomes(sendOutcome);
      setPendingOutcomes(result.remaining);

      if (event === "opened") {
        const lat = nudge.payload.destination_lat;
        const lng = nudge.payload.destination_lng;
        if (typeof lat === "number" && typeof lng === "number") {
          await Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}`);
        }
      }
    },
    [nudges, sendOutcome]
  );

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader title="Route Updates" subtitle="Routes, charging and departure guidance" />
      {loading ? (
        <LoadingState label="Loading route updates…" />
      ) : error && !nudges.length ? (
        <ErrorState message={error} onRetry={() => refresh(true)} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refresh(true)}
              tintColor={Colors.trickeeYellow}
            />
          }
        >
          {error ? <Text style={styles.warning}>{error}</Text> : null}
          {pendingOutcomes > 0 ? (
            <Text style={styles.pending}>
              {pendingOutcomes} action{pendingOutcomes === 1 ? "" : "s"} saved on this phone and waiting to sync.
            </Text>
          ) : null}
          {!nudges.length ? (
            <EmptyState
              icon="bell-outline"
              title="No route updates yet"
              subtitle="Saved trip schedules and important route changes will appear here."
            />
          ) : (
            nudges.map((nudge) => (
              <RouteNudgeCard
                key={nudge.id}
                nudge={nudge}
                onAction={(event) => handleAction(nudge, event)}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  warning: {
    backgroundColor: "rgba(255,202,32,0.08)",
    borderRadius: 10,
    color: Colors.trickeeYellow,
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
  },
  pending: {
    color: Colors.secondaryText,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
});

export default RouteNudgesScreen;
