# Live Trip Push Nudges Design

## Goal and scope

While a GPS Driver trip is active, use recent cloud GPS and a confirmed trip SOC to send useful route, charger and low-SOC push nudges to that driver. The mobile app's existing Route Updates inbox, FCM receiver and map action display them. Numeric SOC is always marked as an estimate; charging-place listings never imply live connector availability.

## Decision

Evaluate trips in the always-on notification worker every minute. Keep external Google Routes and Places calls outside the telemetry ingestion transaction. A durable per-trip evaluation checkpoint limits API calls to once per five minutes and records the SOC anchor; the existing notification outbox remains the sole durable send queue. This is smaller and safer for the pilot than adding another streaming protocol or calling Google APIs in the GPS processor.

## Inputs and decisions

- Only active trips with a live-state snapshot received within 90 seconds, valid GPS coordinates, and an active assigned driver are eligible.
- Destination comes from an explicit trip destination when present, otherwise the next unresolved stop in a confirmed same-day Daily Plan whose departure is near the current time. No route or arrival-SOC claim is made without a destination.
- SOC begins at the trip's confirmed starting SOC, or a newer driver-confirmed reading (including post-charge resume). The latest confirmed reading resets the distance anchor. Current SOC is estimated from GPS distance since that anchor and a conservative energy rate.
- Prefer a recent valid GPS prediction's Wh/km. If none exists, use 1.5 times the vehicle's usable-capacity/certified-range rate and label the source as a conservative vehicle-spec baseline. Missing capacity/rate/SOC yields no numeric SOC claim.
- A route nudge requires a Google Routes response with traffic delay of at least ten minutes and 20% of free-flow duration. It reports the changed ETA and links to the destination; it never claims a better route without an evaluated alternative.
- A low-SOC nudge is emitted at estimated 20% and 10% thresholds, or if the verified route predicts arrival below 15%. A threshold fires once per SOC anchor.
- A charger nudge requires a verified Google Places station within five kilometres, a low current or predicted arrival SOC, and enough conservative estimated range to reach the station. The message explicitly says availability is unconfirmed.
- Per-type cooldowns and a per-trip hourly cap prevent repeats; urgent 10% SOC alerts are exempt from the cap. Each outbox row has a stable idempotency key and 30-minute expiry.
- Missing provider evidence suppresses the relevant route/charger claim. Provider failures are logged as short reason codes and do not block GPS ingestion or other notification types.

## Delivery and safety

- The notification worker creates outbox rows and sends due rows through FCM. It must validate the FCM project ID on startup, handle transport errors as retryable, and log aggregate evaluation/delivery counts without tokens, coordinates, or PII.
- The worker needs read access to the existing Google Maps API key secret. Production's malformed `TRICKEE_FCM_PROJECT_ID` must be corrected during deployment.
- The existing Android receiver and Route Updates inbox consume the payload; Android `1.0.20 (22)` labels route, charger and SOC alerts distinctly. A physical handset canary is required to verify notification permission, background receipt, deep link, and message timing.

## Verification

Test fresh/stale GPS, destination selection, model/spec energy source, charging reset, provider failure, route-delay threshold, charger reachability, cooldown/idempotency, ownership, FCM retry, migration upgrade/downgrade, and full backend suite. After deployment, confirm a future active-trip canary produces pending then sent outbox rows with an FCM message ID and appears on the tester phone. A server-side FCM success alone is not handset delivery proof.
