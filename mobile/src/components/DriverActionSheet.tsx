/**
 * DriverActionSheet — trip start/stop, SOC entry, charging, waiting, SOS.
 *
 * GPS-first additions (§5.3):
 * - Trip start provisions and starts the native foreground collector.
 * - Trip end seals the native Room outbox before declaring final sequence.
 * - SOC entry prompt on trip start for GPS-only vehicles
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Colors } from "../constants/Colors";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useLiveData } from "../context/LiveDataContext";
import SOCEntryModal from "./SOCEntryModal";
import CalculationOverlay from "./CalculationOverlay";
import {
  prepareTelemetryCollector,
  startTelemetryTrip,
  stopTelemetryTrip,
} from "../services/telemetryNative";
import { waitForTripFinalization } from "../services/tripFinalization";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const DriverActionSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { token } = useAuth();
  const { me, vehicle, refresh } = useLiveData();
  const [loading, setLoading] = useState(false);
  const [socModalVisible, setSocModalVisible] = useState(false);
  const [startSocModalVisible, setStartSocModalVisible] = useState(false);
  const [endSocModalVisible, setEndSocModalVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calculationVisible, setCalculationVisible] = useState(false);
  const [calculationResult, setCalculationResult] = useState<any>();
  const [calculationError, setCalculationError] = useState<string | null>(null);

  const activeTrip = me?.active_trip;

  const handleStartTrip = () => {
    setError(null);
    onClose();
    setStartSocModalVisible(true);
  };

  const completeStartTrip = async (startingSoc: number) => {
    if (!token || !vehicle) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await prepareTelemetryCollector(token, vehicle.id);
      const trip = await api.startTrip(token, {
        vehicle_id: vehicle.id,
        starting_soc: startingSoc,
        idempotency_key: `trip-${Date.now()}`,
      });
      await startTelemetryTrip(trip.id, vehicle.id);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to start trip");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleEndTrip = () => {
    setError(null);
    onClose();
    setEndSocModalVisible(true);
  };

  const completeEndTrip = async (endingSoc: number) => {
    if (!token) {
      return;
    }
    setEndSocModalVisible(false);
    setLoading(true);
    setError(null);
    setCalculationResult(undefined);
    setCalculationError(null);
    setCalculationVisible(true);
    try {
      const telemetry = await stopTelemetryTrip();
      if (!telemetry.tripId) {
        throw new Error("No active native telemetry trip was found.");
      }
      await api.completeTelemetryTrip(token, telemetry.tripId, {
        ending_soc: endingSoc,
        final_sequence_no: telemetry.finalSequenceNo,
        location: telemetry.lastLocation,
        idempotency_key: `end-${Date.now()}`,
      });
      const finalized = await waitForTripFinalization(token, telemetry.tripId);
      if (finalized.state === "completed") {
        setCalculationResult(finalized.overlayResult);
      } else {
        setCalculationResult({ calculation_status: "processing" });
        setCalculationError(finalized.message);
      }
      await refresh();
      onClose();
    } catch (err: any) {
      const message = err.message || "Failed to end trip";
      setCalculationError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };
  const finishCalculation = useCallback(() => {
    setCalculationVisible(false);
    setCalculationResult(undefined);
    setCalculationError(null);
  }, []);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Driver Actions</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            {!activeTrip ? (
              <>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleStartTrip}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={Colors.darkText} />
                  ) : (
                    <Text style={styles.primaryText}>▶ Start Trip</Text>
                  )}
                </TouchableOpacity>

                {vehicle && (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => {
                      onClose();
                      setSocModalVisible(true);
                    }}
                  >
                    <Text style={styles.secondaryText}>🔋 Add SOC Reading</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, styles.endBtn]}
                onPress={handleEndTrip}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.primaryText} />
                ) : (
                  <Text style={[styles.primaryText, styles.endText]}>
                    ⏹ End Trip
                  </Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {vehicle && (
        <SOCEntryModal
          visible={startSocModalVisible}
          onClose={() => setStartSocModalVisible(false)}
          vehicleId={vehicle.id}
          title="Starting trip SOC"
          subtitle="Enter the dashboard battery percentage before moving. This becomes the trip's measured energy baseline."
          submitLabel="Start GPS Trip"
          onSubmit={completeStartTrip}
        />
      )}
      {vehicle && (
        <SOCEntryModal
          visible={socModalVisible}
          onClose={() => setSocModalVisible(false)}
          vehicleId={vehicle.id}
          onRecorded={refresh}
        />
      )}
      {vehicle && (
        <SOCEntryModal
          visible={endSocModalVisible}
          onClose={() => setEndSocModalVisible(false)}
          vehicleId={vehicle.id}
          title="End trip SOC"
          subtitle="Enter the battery percentage shown now. Trickee will combine it with the complete GPS route."
          submitLabel="Calculate Trip"
          onSubmit={completeEndTrip}
        />
      )}
      <CalculationOverlay
        visible={calculationVisible}
        result={calculationResult}
        error={calculationError}
        onFinished={finishCalculation}
      />
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: Colors.cardBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    color: Colors.primaryText,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  error: { color: Colors.red, fontSize: 12, marginBottom: 12 },
  primaryBtn: {
    backgroundColor: Colors.trickeeYellow,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryText: { color: Colors.darkText, fontWeight: "700", fontSize: 16 },
  endBtn: { backgroundColor: Colors.red },
  endText: { color: Colors.primaryText },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryText: { color: Colors.primaryText, fontWeight: "600", fontSize: 14 },
  cancelBtn: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  cancelText: { color: Colors.secondaryText, fontWeight: "600" },
});

export default DriverActionSheet;
