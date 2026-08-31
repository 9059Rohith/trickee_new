# GPS Driver Telemetry Transport Decision

**Date:** 2026-09-01

**Status:** Recommended for the current repair; review after the next physical-device trip

**Decision owner:** Trickee GPS Driver pilot

## Purpose

Record why the GPS Driver should retain HTTPS resumable batch uploads as its
authoritative phone-to-cloud transport, where WebSocket belongs, and when MQTT
should be reconsidered. This decision must be reviewed after the current
acknowledgement, retry, reconciliation, and finalization repairs are implemented
and tested on the pilot phone.

## Decision

Keep the existing transport family and evolve it into a versioned, resumable
HTTPS batch protocol backed by the Android Room outbox.

```text
GPS and IMU capture
        |
        v
Atomic Room trip and outbox write
        |
        v
HTTPS idempotent batch upload
        |
        v
Atomic backend receipt and telemetry insert
        |
        v
Exact accepted, duplicate, rejected, and missing ranges
        |
        v
Phone acknowledges only server-confirmed rows
```

Room remains the source of truth until the backend explicitly confirms a row.
The delivery model is **at least once with idempotent server writes**: a request
may be repeated, but a telemetry window must not be lost or stored twice.

## Required acknowledgement contract

A successful batch response should distinguish every outcome explicitly:

```json
{
  "accepted_ranges": [[7, 20]],
  "duplicate_ranges": [[21, 25]],
  "permanent_rejections": [],
  "contiguous_through": 0,
  "highest_received": 25,
  "missing_ranges": [[1, 6]],
  "retry_after_ms": null
}
```

The phone must:

1. Mark every accepted or duplicate sequence as acknowledged, even if an older
   gap prevents the contiguous cursor from advancing.
2. Retry authentication, connectivity, timeout, rate-limit, and server errors.
3. Preserve contract-invalid rows in a diagnostic dead-letter state instead of
   deleting them.
4. Retain HTTP status, stable error code, attempt count, retry time, and queue
   state without logging tokens or coordinates.
5. Upload the oldest missing ranges before newer backlog.
6. Resume recovery through WorkManager after network loss, process death,
   reboot, or trip completion.

## Why WebSocket is not the authoritative upload path

WebSocket provides a live bidirectional connection, not durable application
delivery. Android may suspend or terminate the process, the phone may change
networks, credentials may expire, and the connection can close between send
and acknowledgement. Room, idempotency, acknowledgement, replay, and
deduplication would still be required.

Use WebSocket only for ephemeral operational behavior:

- live map and vehicle presence updates;
- low-latency queue and trip-status indicators;
- server hints that ask the phone to run a normal HTTPS reconciliation;
- dashboard deltas that recover by fetching an authoritative REST snapshot.

An open WebSocket must never be treated as proof that telemetry is stored.

## Why MQTT is deferred

MQTT 5 with QoS 1 is the strongest future candidate when Trickee needs many
continuously connected vehicles. It provides acknowledged at-least-once
delivery, but duplicates remain possible and application-level telemetry
identity, durable local storage, authorization, idempotency, and reconciliation
are still necessary.

Adopting MQTT now would also add a broker, device identity and certificate
lifecycle, topic authorization, retained-session behavior, monitoring, scaling,
and another production recovery path before field evidence justifies them.

Reconsider MQTT only when measurements show at least one of these conditions:

- hundreds or thousands of simultaneously connected vehicles;
- bidirectional vehicle commands with strict low-latency requirements;
- HTTPS connection and request overhead becomes a measured cost or battery
  bottleneck;
- the current recovery SLA cannot be met with HTTPS batching and WorkManager;
- a managed broker materially reduces total operational complexity.

MQTT evaluation must compare end-to-end durability, battery use, data cost,
operational cost, reconnect behavior, duplicate rate, and recovery time. It
must not be selected only because it appears more real-time.

## What breaks first

The first risk is not transport speed. It is losing the acknowledgement state
between the Room outbox and the backend. A later accepted row must not remain in
the queue merely because an earlier sequence is missing, and a recoverable HTTP
or authentication failure must not permanently reject an entire local batch.

The current repair therefore takes priority over a protocol replacement.

## Baseline incident for comparison

Rhythm trip `3cf056ba-fd7d-4c7c-ba1f-abd7ffc0dc74` is the pre-repair baseline:

| Measure | Baseline |
| --- | ---: |
| Final phone sequence | 1,098 |
| Cloud-stored windows | 675 |
| Actual missing windows | 423 |
| End-to-end upload completeness | 61.48% |
| Highest contiguous sequence | 0 |
| Last phone backlog reported | 359 |
| Backend telemetry rejections | 0 |
| Upload latency p95 | about 250 seconds |

The detailed evidence is workspace-local and intentionally outside the
GPS Driver repository at
`.codex-tmp/rhythm_trip_audit_summary_2026-08-31.md`.

## Post-repair acceptance evidence

After implementation, run a Play-installed physical-device trip that includes
screen-off capture, a deliberate network outage, reconnection, an application
restart, token refresh, trip stop, and backlog recovery. Record:

- final phone sequence and distinct cloud-stored sequences;
- actual missing count and exact missing ranges;
- accepted, duplicate, rejected, and dead-letter counts;
- highest contiguous and highest received sequences;
- maximum and p95 queue age and upload latency;
- phone backlog during outage and after recovery;
- finalizer state and time to completion;
- starting and ending SOC plus energy-label eligibility;
- evidence that a repeated batch remains idempotent.

The repaired pipeline passes when every locally committed telemetry window is
either cloud-acknowledged or retained locally with an explicit actionable
state, the backlog returns to zero after connectivity is restored, the cloud
reconciles the final sequence exactly, and no incomplete trip enters training.

This does not guarantee that Android or the environment supplies a valid GPS
fix every second. A locally committed window without GPS is valid evidence and
must remain visible as a GPS-quality gap rather than a transport loss.

## Review outcome

After the post-repair trip, choose one outcome and record the evidence here:

- **Retain HTTPS:** recovery and operational targets pass.
- **Tune HTTPS:** durability passes but batch size, cadence, or WorkManager
  scheduling needs adjustment.
- **Run an MQTT spike:** measured scale, latency, battery, or recovery evidence
  crosses one of the MQTT reconsideration thresholds.

Do not replace the authoritative upload path with WebSocket.

## References

- Android background data transfer guidance:
  <https://developer.android.com/develop/background-work/background-tasks/data-transfer-options>
- Android WorkManager reference:
  <https://developer.android.com/reference/androidx/work/WorkManager.html>
- WebSocket protocol, RFC 6455: <https://www.rfc-editor.org/rfc/rfc6455>
- MQTT 5.0 standard: <https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html>
- Master GPS/IMU architecture:
  `../superpowers/specs/2026-08-05-android-live-gps-imu-master-system-design.md`
