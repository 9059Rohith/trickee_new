# Actionable Live Trip Nudges Design

## Intent and boundary

During an active GPS Driver trip, give the assigned driver timely, actionable advice based on recent GPS, a confirmed SOC anchor, the conservative energy rate, Google traffic-aware routes, and charger listings. The driver chose one-tap acceptance of a proposed route. This is a pilot release, not autonomous navigation or measured scooter-BMS SOC.

## Evidence and decision flow

1. The existing notification worker evaluates an active, assigned trip only when its cloud GPS snapshot is at most 90 seconds old and no waiting/charging stop is open. Keep third-party calls outside telemetry ingestion. Evaluate at most every two minutes per trip; retain the existing outbox, FCM, expiry, idempotency, and per-type cooldowns.
2. Re-anchor estimated current SOC to the latest confirmed dashboard SOC, including after charging. Subtract GPS distance times a conservative Wh/km rate. Prefer a recent confident GPS prediction; otherwise use the conservative vehicle-spec rate. If the anchor, distance, usable capacity, or rate is absent, show no numeric SOC or percentage-saving claim.
3. If the trip has a destination, request traffic-aware default and alternate Google Routes. Preserve each returned route's distance, duration, traffic delay, and geometry. Compute an estimated arrival SOC per route from the same energy rate. The default route is normally Google's quickest; do not claim an alternate saves time unless the provider numbers prove it. A traffic nudge can say traffic adds time and offer the best current route; a shorter alternate may be offered as an energy-saving tradeoff only when its projected SOC advantage is material and its time penalty is bounded. No alternative or route outage means no rerouting claim.
4. When current SOC is at most 25% or projected arrival SOC at most 20%, search up to ten nearby charger listings. For the pilot Ola S1, only a listing explicitly identified as an Ola Hypercharger is eligible for a push; other EV stations may be incompatible. Recheck the closest candidate by a driving route, then calculate estimated SOC at that station. Require a conservative 5% arrival reserve. Say "charging option" and "availability unknown"; never state a free slot, guaranteed compatibility, charging speed, or charge gain without evidence.
5. A route nudge includes a bounded suggested-route identity, destination, optional route-shaping waypoint, provider timestamp, ETA/traffic comparison, and estimated arrival SOC. The Route Updates card presents the facts with "Estimated" labels. One tap opens Google Maps to review/navigation and records acceptance only after the map handoff succeeds. Google Maps may recalculate the path, so the UI does not promise an exact route switch. A charger nudge similarly opens directions to the listed charger; it does not reserve a connector.

## Safety, failure, and rollout

- SOC is estimated from a manually confirmed anchor and GPS distance, not a live BMS reading. Do not train or advertise a new model from synthetic-only evidence. Never infer battery saving merely from a faster ETA; compare predicted energy/arrival SOC and show a number only when supported.
- Suppress stale GPS, missing destination route claims, invalid provider facts, unverified charger candidates, unreachable candidates, and stale/expired actions. Provider failure must not stop SOC alerts or FCM delivery. Keep notifications bounded and deduplicated; urgent SOC remains higher priority.
- The server owns trip/driver authorization and source facts. Notifications include no raw GPS trace, token, or secret. Persist evidence in the outbox payload and outcome; aggregate worker logs omit precise locations and PII.
- Backward-compatible JSON payload extension only; no schema migration unless implementation reveals a necessary durable field. Test with fake provider responses, cloud-worker canary, signed Android build, and physical handset. FCM success alone is not display proof. Roll back the worker revision and use the previous AAB if the pilot canary fails.

## Acceptance

- A low-SOC active trip can produce a truthful SOC nudge and a reachable Ola Hypercharger suggestion with road distance and estimated SOC at arrival, while slot availability remains unknown.
- A verified traffic delay produces a route nudge with current ETA and estimated arrival SOC; an alternative is presented only with a valid provider comparison. One tap opens Maps and records the action; a failed handoff does not claim acceptance.
- No false nudge is emitted for stale GPS, an ended trip, missing SOC, unsupported charger, provider outage, an unreachable charger, or a route without a meaningful traffic/energy improvement. No duplicate push occurs on evaluator restarts.
