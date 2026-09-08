import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RouteNudge, RouteNudgeEvent } from "./types";

const INBOX_KEY = "trickee.route-nudges.inbox.v1";
const OUTCOME_KEY = "trickee.route-nudges.outcomes.v1";
const CORRUPT_OUTCOME_KEY = "trickee.route-nudges.outcomes.corrupt.v1";

export type NudgeOutcomeRequest = {
  event: RouteNudgeEvent;
  occurred_at: string;
  selected_route_id?: string;
  selected_charger_id?: string;
  metadata?: Record<string, unknown>;
};

type QueuedNudgeOutcome = {
  nudgeId: string;
  idempotencyKey: string;
  payload: NudgeOutcomeRequest;
  attempts: number;
  lastError?: string;
};

type OutcomeSender = (
  nudgeId: string,
  payload: NudgeOutcomeRequest
) => Promise<unknown>;

let mutation = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutation.then(operation, operation);
  mutation = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function readOutcomeQueue(): Promise<QueuedNudgeOutcome[]> {
  const raw = await AsyncStorage.getItem(OUTCOME_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Preserve evidence before recovering a usable queue.
  }
  await AsyncStorage.setItem(CORRUPT_OUTCOME_KEY, raw);
  return [];
}

async function writeOutcomeQueue(queue: QueuedNudgeOutcome[]): Promise<void> {
  await AsyncStorage.setItem(OUTCOME_KEY, JSON.stringify(queue));
}

export async function loadCachedRouteNudges(): Promise<RouteNudge[]> {
  const raw = await AsyncStorage.getItem(INBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCachedRouteNudges(
  nudges: RouteNudge[]
): Promise<void> {
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(nudges.slice(0, 100)));
}

export function enqueueNudgeOutcome(
  nudgeId: string,
  event: RouteNudgeEvent,
  details: Omit<NudgeOutcomeRequest, "event" | "occurred_at"> = {}
): Promise<void> {
  return serialize(async () => {
    const queue = await readOutcomeQueue();
    const idempotencyKey = `${nudgeId}:${event}`;
    if (queue.some((item) => item.idempotencyKey === idempotencyKey)) return;
    queue.push({
      nudgeId,
      idempotencyKey,
      payload: {
        event,
        occurred_at: new Date().toISOString(),
        ...details,
      },
      attempts: 0,
    });
    await writeOutcomeQueue(queue);
  });
}

export function pendingNudgeOutcomeCount(): Promise<number> {
  return serialize(async () => (await readOutcomeQueue()).length);
}

export function flushNudgeOutcomes(
  sender: OutcomeSender
): Promise<{ flushed: number; remaining: number }> {
  return serialize(async () => {
    const queue = await readOutcomeQueue();
    const remaining: QueuedNudgeOutcome[] = [];
    let flushed = 0;
    for (const item of queue) {
      try {
        await sender(item.nudgeId, item.payload);
        flushed += 1;
      } catch (error) {
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        });
      }
    }
    await writeOutcomeQueue(remaining);
    return { flushed, remaining: remaining.length };
  });
}
