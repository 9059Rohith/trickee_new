import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import DestinationPicker from "../../components/DestinationPicker";
import DetailHeader from "../../components/DetailHeader";
import LocationPickerModal from "../../components/LocationPickerModal";
import { Colors } from "../../constants/Colors";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api } from "../../services/api";
import { runWithSessionRecovery } from "../../services/sessionRecovery";
import { currentPlannerLocation, prepareTelemetryCollector, startTelemetryTrip } from "../../services/telemetryNative";
import {
  adjustManualDestinationPin,
  createTripStartAttemptId,
  destinationFromSearchResult,
  executeTripStart,
  plannedDestinationFromNextLeg,
  validateTripStart,
  type TripDestination,
} from "../../services/tripStart";
import { fontFamily } from "../../theme/typography";

const defaultCenter = { lat: 21.1702, lng: 72.8311 };
const manualDestination = (): TripDestination => ({ mode: "manual", text: "", lat: null, lng: null, source: "search_result" });

const TripStartScreen: React.FC<any> = ({ navigation, route }) => {
  const { token, restore } = useAuth();
  const { vehicle, latestSoc, refresh } = useLiveData();
  const requestedPlanId = route?.params?.planId;
  const requestedLegIndex = route?.params?.legIndex;
  const requested = useMemo(
    () => requestedPlanId != null && Number.isInteger(requestedLegIndex)
      ? { planId: String(requestedPlanId), legIndex: Number(requestedLegIndex) }
      : undefined,
    [requestedLegIndex, requestedPlanId]
  );
  const [destination, setDestination] = useState<TripDestination>(manualDestination());
  const [startingSoc, setStartingSoc] = useState(latestSoc == null ? "" : String(Math.round(latestSoc)));
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapInitial, setMapInitial] = useState(defaultCenter);
  const [mapFallback, setMapFallback] = useState(true);
  const [mapInitialSource, setMapInitialSource] = useState<"device_location" | "search_result">("device_location");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAttempt = useRef(0);
  const tripId = useRef(`trip-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
  const idempotencyKey = useRef(createTripStartAttemptId());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    runWithSessionRecovery(token, restore, sessionToken => api.getNextDailyPlanLeg(sessionToken))
      .then(leg => {
        if (cancelled) return;
        const planned = plannedDestinationFromNextLeg(leg, requested);
        if (planned) {
          setDestination(planned);
        } else if (requested) {
          setPlanNotice("That reminder is stale or no longer belongs to this account. Choose the current planned stop, a map pin, or destinationless recording.");
          const fallback = plannedDestinationFromNextLeg(leg);
          if (fallback) setDestination(fallback);
        } else {
          const fallback = plannedDestinationFromNextLeg(leg);
          if (fallback) setDestination(fallback);
        }
      })
      .catch(() => {
        if (!cancelled) setPlanNotice("Planned-stop validation is unavailable. Manual and destinationless GPS recording remain available.");
      })
      .finally(() => { if (!cancelled) setLoadingPlan(false); });
    return () => { cancelled = true; };
  }, [requested, restore, token]);

  const draft = useMemo(() => ({
    tripId: tripId.current,
    vehicleId: vehicle?.id || "",
    startingSoc: Number(startingSoc),
    idempotencyKey: idempotencyKey.current,
    destination,
  }), [destination, startingSoc, vehicle?.id]);
  const validation = validateTripStart(draft);

  const openMap = async () => {
    const existing = destination.mode === "manual" && destination.lat != null && destination.lng != null
      ? { lat: destination.lat, lng: destination.lng }
      : null;
    setMapInitialSource(existing && destination.mode === "manual" && destination.source === "search_result" ? "search_result" : "device_location");
    const current = existing || await currentPlannerLocation().catch(() => null);
    setMapInitial(current || defaultCenter);
    setMapFallback(current == null);
    setMapOpen(true);
  };

  const searchDestination = async (query: string) => {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (normalized.length < 3) {
      setSearchError("Enter at least three characters to find a destination.");
      return;
    }
    if (!token) {
      setSearchError("Sign in again to search for a destination.");
      return;
    }
    const attempt = ++searchAttempt.current;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await runWithSessionRecovery(token, restore, sessionToken =>
        api.resolveDestination(sessionToken, normalized)
      );
      if (attempt !== searchAttempt.current) return;
      const resolved = destinationFromSearchResult(result);
      setDestination(resolved);
      setMapInitial({ lat: resolved.lat!, lng: resolved.lng! });
      setMapFallback(false);
      setMapInitialSource("search_result");
      setMapOpen(true);
    } catch (caught) {
      if (attempt === searchAttempt.current) {
        setSearchError(caught instanceof Error ? caught.message : "Could not find that destination.");
      }
    } finally {
      if (attempt === searchAttempt.current) setSearching(false);
    }
  };

  const confirmMap = (coordinates: { lat: number; lng: number }, adjusted: boolean) => {
    if (destination.mode === "manual") {
      const preserveSearchResult = mapInitialSource === "search_result" && !adjusted;
      setDestination(preserveSearchResult ? {
        ...destination,
        lat: coordinates.lat,
        lng: coordinates.lng,
      } : adjustManualDestinationPin(destination, coordinates));
    } else {
      setDestination({ mode: "manual", text: "Pinned destination", lat: coordinates.lat, lng: coordinates.lng, source: "map_pin" });
    }
    setMapOpen(false);
  };

  const submit = async () => {
    if (!token || !vehicle || busy) return;
    if (!validation.valid) {
      setError(validation.reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const origin = await currentPlannerLocation().catch(() => undefined);
      const submission = { ...draft, ...(origin ? { origin } : {}) };
      await runWithSessionRecovery(token, restore, sessionToken => executeTripStart(submission, {
        prepareCollector: () => prepareTelemetryCollector(sessionToken, vehicle.id),
        createTrip: payload => api.startTrip(sessionToken, payload),
        startNative: startTelemetryTrip,
      }));
      await refresh();
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the trip.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <DetailHeader title="Start Trip" subtitle="Confirm destination and dashboard SOC" />
      <ScrollView testID="animated-trip-start-flow" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.introCard}>
          <Text style={styles.eyebrow}>TRIP INITIALIZATION</Text>
          <Text style={styles.introTitle}>Pin where you are going.</Text>
          <Text style={styles.introCopy}>Search, speak, or move the map pin. The selected destination stays editable until GPS capture begins.</Text>
        </View>
        {loadingPlan ? <View style={styles.loading}><ActivityIndicator color={Colors.trickeeYellow} /><Text style={styles.muted}>Checking today’s plan…</Text></View> : null}
        {planNotice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{planNotice}</Text> : null}
        <DestinationPicker
          destination={destination}
          onChange={next => {
            searchAttempt.current += 1;
            setSearching(false);
            setDestination(next);
            setSearchError(null);
          }}
          onPickMap={openMap}
          onSearch={searchDestination}
          searching={searching}
          searchError={searchError}
        />
        <View style={styles.socBlock}>
          <Text style={styles.label}>Starting dashboard SOC</Text>
          <TextInput
            testID="trip-start-soc"
            accessibilityLabel="Starting dashboard battery percentage"
            style={styles.socInput}
            value={startingSoc}
            onChangeText={setStartingSoc}
            placeholder="e.g. 82"
            placeholderTextColor={Colors.secondaryText}
            keyboardType="numeric"
            maxLength={5}
          />
          <Text style={styles.evidence}>Source: vehicle dashboard confirmed by driver</Text>
        </View>
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          testID="trip-start-submit"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !validation.valid }}
          style={[styles.submit, (busy || !validation.valid) && styles.submitDisabled]}
          disabled={busy || !validation.valid}
          onPress={submit}
        >
          {busy ? <ActivityIndicator color={Colors.darkText} /> : <Text style={styles.submitText}>Start GPS Trip</Text>}
        </TouchableOpacity>
        <Text style={styles.footnote}>The backend creates the trip first. Native foreground GPS capture starts only after that succeeds.</Text>
      </ScrollView>
      <LocationPickerModal visible={mapOpen} initialCoordinates={mapInitial} initialSource={mapInitialSource} fallbackUsed={mapFallback} onConfirm={confirmMap} onClose={() => setMapOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, gap: 18, paddingBottom: 48 },
  introCard: { gap: 7, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: Colors.liquidGlassBorder, backgroundColor: "rgba(72,223,244,0.045)" },
  eyebrow: { color: Colors.motionCyan, fontFamily: fontFamily.technical, fontSize: 9, letterSpacing: 1.2 },
  introTitle: { color: Colors.white, fontFamily: fontFamily.headingBold, fontSize: 22 },
  introCopy: { color: Colors.secondaryText, fontFamily: fontFamily.body, fontSize: 13, lineHeight: 19 },
  loading: { flexDirection: "row", alignItems: "center", gap: 10 },
  muted: { color: Colors.secondaryText, fontFamily: fontFamily.body },
  notice: { color: Colors.trickeeYellow, borderWidth: 1, borderColor: "rgba(255,202,32,0.35)", backgroundColor: Colors.estimatedBadgeBg, borderRadius: 12, padding: 12, lineHeight: 18 },
  socBlock: { gap: 8 },
  label: { color: Colors.primaryText, fontFamily: fontFamily.heading, fontSize: 14 },
  socInput: { minHeight: 62, borderRadius: 14, borderWidth: 1, borderColor: Colors.liquidGlassBorder, color: Colors.white, backgroundColor: Colors.premiumCardBg, textAlign: "center", fontFamily: fontFamily.headingBold, fontSize: 28 },
  evidence: { color: Colors.secondaryText, fontFamily: fontFamily.body, fontSize: 12, textAlign: "center" },
  error: { color: Colors.redSoft, lineHeight: 18, textAlign: "center" },
  submit: { minHeight: 54, borderRadius: 15, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center" },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: Colors.darkText, fontFamily: fontFamily.bodyHeavy, fontSize: 16 },
  footnote: { color: Colors.secondaryText, fontFamily: fontFamily.body, fontSize: 11, lineHeight: 16, textAlign: "center" },
});

export default TripStartScreen;
