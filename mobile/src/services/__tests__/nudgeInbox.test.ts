import {
  mergeRouteNudges,
  parseRouteNudgeTarget,
  parseNotificationTarget,
  routeNudgeFromRemoteMessage,
} from "../nudgeInbox";
import type { RouteNudge } from "../types";

const nudge = (overrides: Partial<RouteNudge> = {}): RouteNudge => ({
  id: "nudge-1",
  nudge_type: "departure",
  title: "Leave in 10 minutes",
  body: "Ring Road is currently the quickest feasible route.",
  payload: {
    screen: "route_nudge",
    decision_id: "decision-1",
    selected_route_id: "ring-road",
  },
  delivery_status: "sent",
  attempts: 1,
  due_at: "2026-09-08T08:00:00+05:30",
  outcome: null,
  ...overrides,
});

describe("route nudge inbox", () => {
  it("deduplicates by immutable nudge id and prefers the server row", () => {
    const local = nudge({ delivery_status: "pending" });
    const remote = nudge({ delivery_status: "sent", attempts: 2 });

    expect(mergeRouteNudges([local], [remote])).toEqual([remote]);
  });

  it("rejects arbitrary notification URLs and unknown screens", () => {
    expect(
      parseRouteNudgeTarget({
        screen: "route_nudge",
        nudge_id: "nudge-1",
        url: "https://attacker.example",
      })
    ).toBeNull();
    expect(
      parseRouteNudgeTarget({ screen: "admin", nudge_id: "nudge-1" })
    ).toBeNull();
  });

  it("accepts only bounded plan-start notification identifiers", () => {
    expect(parseNotificationTarget({
      screen: "trip_start",
      nudge_id: "nudge-next",
      plan_id: "plan-1",
      leg_index: "2",
    })).toEqual({ screen: "trip_start", nudgeId: "nudge-next", planId: "plan-1", legIndex: 2 });
    expect(parseNotificationTarget({
      screen: "trip_start",
      nudge_id: "nudge-next",
      plan_id: "../../admin",
      leg_index: "2",
    })).toBeNull();
    expect(parseNotificationTarget({
      screen: "trip_start",
      nudge_id: "nudge-next",
      plan_id: "plan-1",
      leg_index: "2",
      url: "https://attacker.example",
    })).toBeNull();
  });

  it("parses only bounded route-nudge identifiers and numeric route facts", () => {
    expect(
      routeNudgeFromRemoteMessage({
        notification: { title: "Route update", body: "Traffic changed." },
        data: {
          screen: "route_nudge",
          nudge_id: "nudge-9",
          decision_id: "decision-9",
          arrival_soc_pct: "27.4",
          destination_lat: "23.0225",
          destination_lng: "72.5714",
        },
      })
    ).toMatchObject({
      id: "nudge-9",
      payload: {
        decision_id: "decision-9",
        arrival_soc_pct: 27.4,
        destination_lat: 23.0225,
        destination_lng: 72.5714,
      },
    });
  });

  it("uses the title and body from a data-only FCM push", () => {
    expect(routeNudgeFromRemoteMessage({data: {
      screen: "route_nudge", nudge_id: "nudge-10", nudge_type: "live_soc",
      title: "Battery check recommended", body: "Estimated battery is low.",
    }})).toMatchObject({title: "Battery check recommended", body: "Estimated battery is low."});
  });
});
