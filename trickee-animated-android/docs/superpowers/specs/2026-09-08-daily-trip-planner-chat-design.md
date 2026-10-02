# Daily Trip Planner Chat Design

**Created:** 2026-09-08  
**Status:** Approved for a five-hour pilot build by the user's instruction to build the proposed daily planner  
**Target:** Trickee GPS Driver `com.trickee.gpsdriverapp`, based on 1.0.11 (12)  
**Confidence:** High for the local software slice; Medium for live routing; Low for background delivery until cloud and physical-device verification

## Goal

Let a tester describe the full day in one chat-style message, confirm the extracted stops, and receive one traceable day plan containing per-leg departure time, ETA, projected arrival SOC, charging opportunities, and schedule nudges.

## Approaches Considered

1. **LLM conversation with allowlisted tool calling plus deterministic planning (chosen).** The LLM gathers and clarifies the schedule, then calls typed server tools; route, energy, charging, and notification services calculate every factual value. This keeps the conversational UX without allowing an LLM to invent SOC, traffic, charger availability, or send decisions.
2. **Free-form LLM agent.** Fastest demo, but unsafe because model wording can be mistaken for measured traffic, battery, or charger evidence.
3. **Form-only planner.** Most deterministic, but does not satisfy the requested chat workflow and is slower for a driver entering many stops.

## Five-Hour Pilot Scope

- One text message describing a single local day, for example: `Office at 9:00, client at 12:30, warehouse at 16:00, home by 19:00`.
- Explicit date, timezone, starting SOC, and assigned vehicle.
- Parsed draft with ordered stop labels and requested arrival times.
- Confirmation before anything is saved or scheduled.
- Destination resolution through a bounded provider adapter. Unresolved places remain visible and block numeric predictions for that leg.
- Sequential leg planning: each leg starts from the previous leg's projected arrival SOC.
- Per-leg distance, duration/ETA, projected energy, projected arrival SOC, source, confidence, and degraded reason.
- Charging suggestions only when place, detour, power, and usable time evidence justify them. Place existence is never called live availability.
- One route-update inbox with Accept, Dismiss, and Open map actions; actions persist locally before upload.
- Local backend/mobile automated gates and a signed local test artifact if the existing upload-key configuration is available.

## Not Promised by the Five-Hour Local Build

- Production deployment without an authenticated inventory and database backup.
- Play publication without verifying versionCode 13+, the registered upload certificate, and console acceptance.
- Background FCM arrival without the correct Firebase Android configuration and a physical handset trace.
- Live charger queue or connector-slot availability without a CPO/operator feed.
- A valid prediction when a stop cannot be resolved to coordinates or vehicle/SOC inputs are missing.

## Architecture

```text
Chat message
  -> LLM conversation controller
  -> allowlisted typed tool calls
  -> bounded schedule parser
  -> explicit draft shown to tester
  -> confirmation
  -> destination resolver
  -> deterministic route + energy + charging orchestration
  -> persisted day plan and per-leg evidence
  -> durable high-priority notification outbox
  -> GPS Driver inbox / later FCM delivery
```

The LLM is the conversation controller. It may ask for missing schedule details and call only these server-side tools:

- `parse_day_schedule`: validate and normalize stop labels and local times.
- `resolve_destination`: resolve a user-confirmed place through the configured place/geocoding provider.
- `plan_route_leg`: obtain route alternatives and traffic evidence from the configured route provider.
- `estimate_leg_energy`: calculate energy and arrival SOC from route facts, vehicle specs, and approved prediction/physics functions.
- `find_route_chargers`: query real nearby/along-route charging places through the configured external provider.
- `evaluate_charging_opportunity`: calculate usable charging time and SOC gain only from confirmed power and bounded queue/detour evidence.
- `schedule_day_notifications`: create idempotent high-priority departure, low-SOC, material-reroute, and charging-opportunity outbox rows.

Each tool uses a strict schema and returns evidence source, timestamp, confidence, and degraded reason. The LLM may explain those values but cannot supply or override coordinates, route metrics, SOC, charger facts, severity, or send/no-send decisions. Raw one-second telemetry is not sent to the LLM.

External API calls run only from the backend with explicit timeout, cache, quota and sanitized-error handling. Google Routes/Places are the selected pilot adapters, but provider configuration stays replaceable. Charger place existence remains distinct from live connector availability.

## Data Contract

`DailyPlanDraft` contains:

- `service_date`
- `timezone`
- `starting_soc_pct`
- `vehicle_id`
- ordered `stops[]` with `label`, `requested_arrival_local`, optional resolved coordinates, and resolution status
- `parser_source` and `parser_warnings`

`DailyPlanResult` adds ordered `legs[]` with:

- `origin` and `destination`
- `planned_departure_at` and `estimated_arrival_at`
- `distance_m`, `duration_s`, and `traffic_delay_s` when provider evidence exists
- `energy_wh` and `arrival_soc_pct` when inputs are sufficient
- `route_source`, `energy_source`, `confidence`, and `degraded_reason`
- optional conservative charger opportunity evidence

Every numeric prediction must be derived from persisted inputs. Missing evidence produces `null` plus a reason, never zero or a fabricated default.

## Conversation Flow

1. App prompts for today's stops and times.
2. Tester enters one message.
3. Backend returns a draft; the app renders editable/confirmable stops.
4. Tester confirms.
5. Backend resolves locations and computes legs sequentially.
6. App shows the day summary and any blocked legs.
7. Confirmed departures create idempotent outbox rows.
8. Driver actions are cached locally first and reconciled with the backend.

## Failure Rules

- Ambiguous or missing times: keep the stop but mark `needs_confirmation`.
- Unresolved place: no route, ETA, energy, or arrival SOC for that leg.
- Route provider unavailable: show a degraded result; do not claim live traffic.
- Starting SOC or usable capacity unavailable: route may display, SOC prediction stays null.
- Network loss: retain the draft and outcomes locally; retry on foreground refresh.
- Push failure: telemetry collection continues unchanged; outbox status remains observable.
- LLM/provider timeout: preserve the confirmed draft and return a retryable degraded state.
- Invalid or unrecognized LLM tool call: reject it server-side; never execute arbitrary code or URLs.

## Release Constraints

- Next release versionCode is at least 13.
- Package remains `com.trickee.gpsdriverapp` and uses the existing registered upload key.
- Room migrations 1-to-2 and 2-to-3 remain intact; daily-plan cache uses AsyncStorage and does not modify telemetry tables.
- Actionable nudge notifications use FCM high priority and a dedicated Android high-importance channel with IDs separate from telemetry notifications 2101/2102. Duplicate suppression, quiet-hours policy, expiry and rate limits still apply.

## Verification

- Parser tests cover multiple stops, 12/24-hour time, ambiguity, invalid SOC, and hostile text.
- Orchestrator tests prove SOC is sequential and incomplete legs do not fabricate outputs.
- API tests prove driver scoping, confirmation idempotency, and one outbox row per occurrence.
- Mobile tests cover draft rendering, confirmation, cache recovery, and outcome retry.
- Full backend, Jest, TypeScript, ESLint, Android JVM, and packaging gates run fresh.
- Live deployment and physical FCM are reported separately from local success.
