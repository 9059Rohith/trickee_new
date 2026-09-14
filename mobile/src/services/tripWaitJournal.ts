import AsyncStorage from "@react-native-async-storage/async-storage";

const JOURNAL_KEY = "trickee.trip-waits.v1";
const CORRUPT_KEY = "trickee.trip-waits.corrupt.v1";

export type LocalTripWait = {
  trip_id: string;
  id: string;
  vehicle_charging: boolean;
  started_at: string;
  ended_at: string | null;
  resume_soc: number | null;
  start_synced: boolean;
  resume_synced: boolean;
  last_error?: string;
};

export type LocalTripWaitState = {
  active: LocalTripWait | null;
  closedIds: string[];
  pendingCount: number;
};

type StartSender = (tripId: string, waitId: string, vehicleCharging: boolean, startedAt: string) => Promise<unknown>;
type ResumeSender = (tripId: string, waitId: string, resumeSoc: number | undefined, endedAt: string) => Promise<unknown>;

let mutation = Promise.resolve();
const flushes = new Map<string, Promise<{ pendingCount: number }>>();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutation.then(operation, operation);
  mutation = result.then(() => undefined, () => undefined);
  return result;
}

async function readJournal(): Promise<LocalTripWait[]> {
  const raw = await AsyncStorage.getItem(JOURNAL_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(item =>
      item && typeof item.trip_id === "string" && typeof item.id === "string" &&
      typeof item.vehicle_charging === "boolean" && typeof item.start_synced === "boolean" &&
      typeof item.resume_synced === "boolean" && (item.ended_at === null || typeof item.ended_at === "string")
    )) return parsed as LocalTripWait[];
  } catch {
    // Preserve the exact bytes for support; never silently lose a charging declaration.
  }
  await AsyncStorage.setItem(CORRUPT_KEY, raw);
  throw new Error("Trip stop history is unavailable. Export diagnostics before ending this trip.");
}

async function writeJournal(journal: LocalTripWait[]): Promise<void> {
  await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
}

export function beginLocalTripWait(tripId: string, waitId: string, vehicleCharging: boolean): Promise<void> {
  return serialize(async () => {
    const journal = await readJournal();
    const existing = journal.find(item => item.trip_id === tripId && item.id === waitId);
    if (existing) {
      if (existing.vehicle_charging !== vehicleCharging) throw new Error("This stop was recorded differently earlier.");
      return;
    }
    if (journal.some(item => item.trip_id === tripId && item.ended_at === null)) {
      throw new Error("Finish the current stop before starting another one.");
    }
    journal.push({
      trip_id: tripId,
      id: waitId,
      vehicle_charging: vehicleCharging,
      started_at: new Date().toISOString(),
      ended_at: null,
      resume_soc: null,
      start_synced: false,
      resume_synced: false,
    });
    await writeJournal(journal);
  });
}

export function adoptServerTripWait(tripId: string, waitId: string, vehicleCharging: boolean, startedAt: string): Promise<void> {
  return serialize(async () => {
    const journal = await readJournal();
    const existing = journal.find(item => item.trip_id === tripId && item.id === waitId);
    if (existing) {
      if (existing.vehicle_charging !== vehicleCharging) throw new Error("This stop conflicts with the saved charging answer.");
      existing.start_synced = true;
    } else {
      if (journal.some(item => item.trip_id === tripId && item.ended_at === null)) {
        throw new Error("Finish the current stop before resuming another one.");
      }
      journal.push({
        trip_id: tripId,
        id: waitId,
        vehicle_charging: vehicleCharging,
        started_at: startedAt,
        ended_at: null,
        resume_soc: null,
        start_synced: true,
        resume_synced: false,
      });
    }
    await writeJournal(journal);
  });
}

export function finishLocalTripWait(tripId: string, waitId: string, resumeSoc?: number): Promise<void> {
  return serialize(async () => {
    const journal = await readJournal();
    const item = journal.find(wait => wait.trip_id === tripId && wait.id === waitId);
    if (!item) throw new Error("Stop was not found on this phone.");
    if (item.vehicle_charging && (resumeSoc === undefined || !Number.isFinite(resumeSoc) || resumeSoc < 0 || resumeSoc > 100)) {
      throw new Error("Post-charge SOC is required before resuming.");
    }
    if (!item.vehicle_charging && resumeSoc !== undefined) throw new Error("SOC is only needed after charging.");
    if (item.ended_at !== null) {
      if (item.resume_soc !== (resumeSoc ?? null)) throw new Error("This stop was resumed with a different SOC earlier.");
      return;
    }
    item.ended_at = new Date().toISOString();
    item.resume_soc = resumeSoc ?? null;
    await writeJournal(journal);
  });
}

export function localTripWaitState(tripId: string): Promise<LocalTripWaitState> {
  return serialize(async () => {
    const waits = (await readJournal()).filter(item => item.trip_id === tripId);
    return {
      active: [...waits].reverse().find(item => item.ended_at === null) ?? null,
      closedIds: waits.filter(item => item.ended_at !== null).map(item => item.id),
      pendingCount: waits.reduce((count, item) => count + Number(!item.start_synced) + Number(item.ended_at !== null && !item.resume_synced), 0),
    };
  });
}

function journalItem(tripId: string, waitId: string): Promise<LocalTripWait | undefined> {
  return serialize(async () => (await readJournal()).find(item => item.trip_id === tripId && item.id === waitId));
}

function updateJournalItem(tripId: string, waitId: string, update: (item: LocalTripWait) => void): Promise<void> {
  return serialize(async () => {
    const journal = await readJournal();
    const item = journal.find(wait => wait.trip_id === tripId && wait.id === waitId);
    if (item) {
      update(item);
      await writeJournal(journal);
    }
  });
}

async function performFlush(tripId: string, sendStart: StartSender, sendResume: ResumeSender): Promise<{ pendingCount: number }> {
  const ids = await serialize(async () => (await readJournal()).filter(item => item.trip_id === tripId).map(item => item.id));
  for (const waitId of ids) {
    try {
      let item = await journalItem(tripId, waitId);
      if (!item) continue;
      if (!item.start_synced) {
        await sendStart(tripId, waitId, item.vehicle_charging, item.started_at);
        await updateJournalItem(tripId, waitId, current => {
          current.start_synced = true;
          current.last_error = undefined;
        });
      }
      item = await journalItem(tripId, waitId);
      if (item && item.ended_at !== null && !item.resume_synced) {
        await sendResume(tripId, waitId, item.resume_soc ?? undefined, item.ended_at);
        await updateJournalItem(tripId, waitId, current => {
          current.resume_synced = true;
          current.last_error = undefined;
        });
      }
    } catch (error) {
      await updateJournalItem(tripId, waitId, item => {
        const status = (error as { status?: number } | null)?.status;
        item.last_error = status ? `HTTP_${status}` : error instanceof Error ? error.name : "UNKNOWN_ERROR";
      });
      break;
    }
  }
  return { pendingCount: (await localTripWaitState(tripId)).pendingCount };
}

export function flushTripWaitJournal(tripId: string, sendStart: StartSender, sendResume: ResumeSender): Promise<{ pendingCount: number }> {
  const previous = flushes.get(tripId) || Promise.resolve({ pendingCount: 0 });
  const operation = previous.catch(() => ({ pendingCount: 0 })).then(() => performFlush(tripId, sendStart, sendResume));
  flushes.set(tripId, operation);
  operation.finally(() => {
    if (flushes.get(tripId) === operation) flushes.delete(tripId);
  }).catch(() => {});
  return operation;
}

export function clearTripWaitJournal(tripId: string): Promise<void> {
  return serialize(async () => {
    const journal = await readJournal();
    await writeJournal(journal.filter(item => item.trip_id !== tripId));
  });
}
