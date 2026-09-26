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
  createTripStartAttemptId,
  executeTripStart,
  plannedDestinationFromNextLeg,
  validateTripStart,
  type TripDestination,
} from "../../services/tripStart";

const defaultCenter = { lat: 21.1702, lng: 72.8311 };
const manualDestination = (): TripDestination => ({ mode: "manual", text: "", lat: null, lng: null, source: "map_pin" });

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
    const current = existing || await currentPlannerLocation().catch(() => null);
    setMapInitial(current || defaultCenter);
    setMapFallback(current == null);
    setMapOpen(true);
  };

  const confirmMap = (coordinates: { lat: number; lng: number }) => {
    const text = destination.mode === "manual" && destination.text.trim()
      ? destination.text.trim()
      : "Pinned destination";
    setDestination({ mode: "manual", text, lat: coordinates.lat, lng: coordinates.lng, source: "map_pin" });
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loadingPlan ? <View style={styles.loading}><ActivityIndicator color={Colors.trickeeYellow} /><Text style={styles.muted}>Checking today’s plan…</Text></View> : null}
        {planNotice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{planNotice}</Text> : null}
        <DestinationPicker destination={destination} onChange={setDestination} onPickMap={openMap} />
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
      <LocationPickerModal visible={mapOpen} initialCoordinates={mapInitial} fallbackUsed={mapFallback} onConfirm={confirmMap} onClose={() => setMapOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, gap: 18, paddingBottom: 48 },
  loading: { flexDirection: "row", alignItems: "center", gap: 10 },
  muted: { color: Colors.secondaryText },
  notice: { color: Colors.trickeeYellow, borderWidth: 1, borderColor: "rgba(255,202,32,0.35)", backgroundColor: Colors.estimatedBadgeBg, borderRadius: 12, padding: 12, lineHeight: 18 },
  socBlock: { gap: 8 },
  label: { color: Colors.primaryText, fontWeight: "800", fontSize: 14 },
  socInput: { minHeight: 62, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, color: Colors.white, backgroundColor: Colors.premiumCardBg, textAlign: "center", fontWeight: "900", fontSize: 28 },
  evidence: { color: Colors.secondaryText, fontSize: 12, textAlign: "center" },
  error: { color: Colors.redSoft, lineHeight: 18, textAlign: "center" },
  submit: { minHeight: 54, borderRadius: 15, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center" },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: Colors.darkText, fontWeight: "900", fontSize: 16 },
  footnote: { color: Colors.secondaryText, fontSize: 11, lineHeight: 16, textAlign: "center" },
});

export default TripStartScreen;
