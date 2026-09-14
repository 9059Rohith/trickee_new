/**
 * DriverActionSheet — trip start/stop, SOC entry, charging, waiting, SOS.
 *
 * GPS-first additions (§5.3):
 * - Trip start provisions and starts the native foreground collector.
 * - Trip end seals the native Room outbox before declaring final sequence.
 * - SOC entry prompt on trip start for GPS-only vehicles
 */
import React, { useCallback, useState } from "react";
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
import { runWithSessionRecovery } from "../services/sessionRecovery";
import { clearTripWaitJournal, localTripWaitState } from "../services/tripWaitJournal";
import { syncTripWaits } from "../services/tripWaitSync";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const DriverActionSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { token, restore } = useAuth();
  const { me, vehicle, refresh } = useLiveData();
  const [calculationVisible, setCalculationVisible] = useState(false);
  const [calculationResult, setCalculationResult] = useState<any>();
  const [calculationError, setCalculationError] = useState<string | null>(null);

  const activeTrip = me?.active_trip;

  const completeStartTrip = async (startingSoc: number) => {
    if (!token || !vehicle) {
      return;
    }
    try {
      const idempotencyKey = `trip-${Date.now()}`;
      const trip = await runWithSessionRecovery(token, restore, async (sessionToken) => {
        await prepareTelemetryCollector(sessionToken, vehicle.id);
        return api.startTrip(sessionToken, {
          vehicle_id: vehicle.id,
          starting_soc: startingSoc,
          idempotency_key: idempotencyKey,
        });
      });
      await startTelemetryTrip(trip.id, vehicle.id);
      await refresh();
    } catch (err: any) {
      throw err;
    }
  };

  const completeEndTrip = async (endingSoc: number) => {
    if (!token) {
      return;
    }
    if (activeTrip) {
      const waitSync = await syncTripWaits(token, restore, activeTrip.id);
      if (waitSync.pendingCount > 0) {
        throw new Error("Stop and charging details are waiting to sync. Reconnect before ending this trip.");
      }
      const savedWait = await localTripWaitState(activeTrip.id);
      if (savedWait.active || (me?.active_waiting && !savedWait.closedIds.includes(me.active_waiting.id))) {
        throw new Error("Resume the waiting or charging stop before ending this trip.");
      }
    }
    onClose();
    setCalculationResult(undefined);
    setCalculationError(null);
    setCalculationVisible(true);
    try {
      const telemetry = await stopTelemetryTrip();
      if (!telemetry.tripId) {
        throw new Error("No active native telemetry trip was found.");
      }
      const idempotencyKey = `end-${Date.now()}`;
      const finalized = await runWithSessionRecovery(token, restore, async (sessionToken) => {
        await api.completeTelemetryTrip(sessionToken, telemetry.tripId!, {
          ending_soc: endingSoc,
          final_sequence_no: telemetry.finalSequenceNo,
          location: telemetry.lastLocation,
          idempotency_key: idempotencyKey,
        });
        return waitForTripFinalization(sessionToken, telemetry.tripId!);
      });
      if (finalized.state === "completed") {
        setCalculationResult(finalized.overlayResult);
      } else {
        setCalculationResult({ calculation_status: "processing" });
        setCalculationError(finalized.message);
      }
      await refresh();
      await clearTripWaitJournal(telemetry.tripId).catch(() => {});
      onClose();
    } catch (err: any) {
      const message = err.message || "Failed to end trip";
      setCalculationError(message);
    }
  };
  const finishCalculation = useCallback(() => {
    setCalculationVisible(false);
    setCalculationResult(undefined);
    setCalculationError(null);
  }, []);

  return (
    <>
      {vehicle && (
        <SOCEntryModal
          visible={visible && !activeTrip}
          onClose={onClose}
          vehicleId={vehicle.id}
          title="Starting trip SOC"
          subtitle="Enter the dashboard battery percentage before moving. This becomes the trip's measured energy baseline."
          submitLabel="Start GPS Trip"
          showSourceSelector={false}
          onSubmit={completeStartTrip}
        />
      )}
      {vehicle && (
        <SOCEntryModal
          visible={visible && Boolean(activeTrip)}
          onClose={onClose}
          vehicleId={vehicle.id}
          title="End trip SOC"
          subtitle="Enter the battery percentage shown now. Trickee will combine it with the complete GPS route."
          submitLabel="Confirm and end trip"
          showSourceSelector={false}
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

export default DriverActionSheet;
