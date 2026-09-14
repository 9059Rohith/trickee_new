import { beginLocalTripWait, finishLocalTripWait } from "./tripWaitJournal";

export async function beginWaitLocally(
  tripId: string, waitId: string, charging: boolean, sync: () => Promise<unknown>
): Promise<void> {
  await beginLocalTripWait(tripId, waitId, charging);
  Promise.resolve().then(sync).catch(() => {});
}

export async function finishWaitLocally(
  tripId: string, waitId: string, soc: number | undefined, sync: () => Promise<unknown>
): Promise<void> {
  await finishLocalTripWait(tripId, waitId, soc);
  Promise.resolve().then(sync).catch(() => {});
}
