import { api } from "./api";
import { runWithSessionRecovery } from "./sessionRecovery";
import { flushTripWaitJournal } from "./tripWaitJournal";

export function syncTripWaits(token: string, restore: () => Promise<string | null>, tripId: string) {
  return flushTripWaitJournal(
    tripId,
    (id, waitId, vehicleCharging, startedAt) => runWithSessionRecovery(token, restore, sessionToken =>
      api.waitTelemetryTrip(sessionToken, id, { wait_id: waitId, vehicle_charging: vehicleCharging, started_at: startedAt })
    ),
    (id, waitId, resumeSoc, endedAt) => runWithSessionRecovery(token, restore, sessionToken =>
      api.resumeTelemetryTrip(sessionToken, id, {
        wait_id: waitId,
        ...(resumeSoc !== undefined ? { resume_soc: resumeSoc } : {}),
        ended_at: endedAt,
      })
    )
  );
}
