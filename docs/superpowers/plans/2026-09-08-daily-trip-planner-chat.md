# Daily Trip Planner Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a chat-style, confirm-before-save daily trip planner with traceable multi-leg ETA, SOC, charging and reminder outputs in the Play-distributed GPS Driver app.

**Architecture:** Add an LLM conversation controller that can call only typed schedule, route, energy, charger and notification tools in the existing GPS Cloud Run backend. Persist confirmed plans and evidence, create idempotent high-priority notification rows, and expose a cached mobile chat/inbox experience without coupling LLM/provider/push failures to telemetry collection.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, Alembic, React Native, TypeScript, AsyncStorage, Jest, Pytest.

**Spec:** `docs/superpowers/specs/2026-09-08-daily-trip-planner-chat-design.md`

## Global Constraints

- Android target is `com.trickee.gpsdriverapp`, based on 1.0.11 (`versionCode 12`); the next released build must use versionCode 13 or higher.
- Preserve Room migrations 1-to-2 and 2-to-3 and do not modify telemetry storage for chat state.
- Missing route, SOC, vehicle-capacity, traffic, charger-power, or availability evidence returns null with an explicit reason.
- The LLM may converse and invoke allowlisted tools; deterministic services and external provider evidence own all numeric and send/no-send decisions.
- External route/place/charger requests have explicit timeouts, caching, quotas and source timestamps.
- Actionable driver nudges use FCM high priority and a dedicated Android high-importance channel, with duplicate suppression and expiry.
- Persist locally before uploading driver actions.
- No production deployment before live target inventory and database backup.

---

### Task 1: Parsed and persisted daily-plan draft

**Files:**
- Create: `backend/app/services/daily_plan_parser.py`
- Modify: `backend/app/models/entities.py`
- Modify: `backend/alembic/versions/0006_route_nudge_delivery.py`
- Create: `backend/tests/test_daily_plan_parser.py`

**Interfaces:**
- Produces: `parse_daily_plan(message: str, service_date: date, timezone_name: str) -> ParsedDailyPlan`.
- Produces persisted `DailyPlan` JSON draft with immutable driver, vehicle, date, timezone and starting SOC inputs.

- [ ] Write failing tests for ordered stop extraction, 12/24-hour times, ambiguity and bounded input.
- [ ] Run `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_daily_plan_parser.py -q` and witness missing service/model failures.
- [ ] Implement a deterministic parser that extracts explicit times and labels, preserves unparsed text as warnings, and never creates coordinates.
- [ ] Add the daily-plan table to migration 0006 and ORM metadata.
- [ ] Rerun the focused tests and migration upgrade/downgrade checks.
- [ ] Commit only Task 1 files.

---

### Task 2: External route, place and charger tool adapters

**Files:**
- Create: `backend/app/services/destination_resolver.py`
- Create: `backend/app/services/daily_plan_tools.py`
- Create: `backend/tests/test_daily_plan_tools.py`

**Interfaces:**
- Produces allowlisted `resolve_destination`, `plan_route_leg`, `estimate_leg_energy`, `find_route_chargers`, and `evaluate_charging_opportunity` tools.
- Every result includes provider source, evidence time, confidence and degraded reason.

- [ ] Write failing tests for provider timeout, cache/quota boundaries, unknown charger power and false availability claims.
- [ ] Run the focused test and witness missing adapter failures.
- [ ] Implement bounded Google place/route/charger adapters with strict normalized outputs.
- [ ] Implement typed tools that call existing prediction/physics and conservative charging functions.
- [ ] Rerun focused tests, including malformed provider output and insufficient-capacity cases.
- [ ] Commit only Task 2 files.

---

### Task 3: LLM conversation, orchestration and driver-scoped APIs

**Files:**
- Create: `backend/app/services/daily_plan_conversation.py`
- Create: `backend/app/services/daily_plan_orchestrator.py`
- Create: `backend/app/routers/daily_plans.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_daily_plan_conversation.py`
- Create: `backend/tests/test_daily_plan_orchestrator.py`
- Create: `backend/tests/test_daily_plans_api.py`

**Interfaces:**
- Produces: `POST /api/v1/daily-plans/chat`, `POST /api/v1/daily-plans/{id}/confirm`, and `GET /api/v1/daily-plans/{id}`.
- Confirmation produces one idempotent notification outbox row per eligible departure.

- [ ] Write failing tests proving only allowlisted typed tools execute, tool results remain authoritative, sequential SOC is preserved, and unresolved stops block numeric claims.
- [ ] Run the focused test and witness 404/import failures.
- [ ] Implement the LLM conversation adapter with strict tool schemas, bounded turns, timeout, sanitized errors and deterministic-parser fallback.
- [ ] Implement sequential orchestration and strict Pydantic requests with bounded messages, timezone validation, SOC limits and assigned-vehicle enforcement.
- [ ] Implement confirmation transaction and unique high-priority notification occurrence keys.
- [ ] Rerun focused and full backend suites.
- [ ] Commit only Task 3 files.

---

### Task 4: GPS Driver chat and day-plan result UI

**Files:**
- Create: `mobile/src/services/dailyPlans.ts`
- Create: `mobile/src/services/__tests__/dailyPlans.test.ts`
- Create: `mobile/src/screens/detail/DailyPlannerScreen.tsx`
- Create: `mobile/src/components/DailyPlanLegCard.tsx`
- Modify: `mobile/src/services/api.ts`
- Modify: `mobile/src/services/types.ts`
- Modify: `mobile/src/navigation/AppNavigator.tsx`
- Modify: `mobile/src/components/SideDrawer.tsx`

**Interfaces:**
- Produces cached draft/confirmed-plan helpers and a chat-style input/confirmation/result screen.
- Consumes the authenticated daily-plan APIs and existing route-nudge inbox.

- [ ] Write failing tests for cache recovery, draft validation and null/degraded output rendering helpers.
- [ ] Run the focused Jest test and witness missing modules.
- [ ] Implement chat input with explicit date, timezone and starting SOC controls; render extracted stops before confirmation.
- [ ] Implement result cards with per-leg ETA/SOC/source and honest unresolved/provider-unavailable states.
- [ ] Register high-priority push receipt/open handling only after the Firebase Android project configuration is verified; use a dedicated channel that cannot affect telemetry service 2101/2102.
- [ ] Persist the current draft/result in AsyncStorage and never couple it to telemetry Room state.
- [ ] Rerun focused Jest, full Jest, TypeScript and ESLint.
- [ ] Commit only Task 4 files.

---

### Task 5: Release gates and handoff

**Files:**
- Modify: `analysis/built_implementation_and_remaining_work.md`
- Modify: `analysis/daily_logger.md`
- Modify version/signing files only after all feature gates pass.

**Interfaces:**
- Produces exact local test evidence and a test artifact; deployment/Play/physical evidence remain separately labeled.

- [ ] Run full backend pytest and migration roundtrip.
- [ ] Run full mobile Jest, TypeScript, ESLint and Android `testDebugUnitTest`.
- [ ] Set versionCode 13+ only when creating the next signed artifact; verify package and certificate before distribution.
- [ ] Inventory Cloud Run service, database head, Firebase project and Play upload identity before any mutation.
- [ ] Back up the production database before applying migration 0006.
- [ ] Record artifact hash, test counts, deployment identifiers and residual live/physical gates in both analysis logs.
- [ ] Commit only reviewed source and evidence files.

## Self-Review

- Spec coverage: parser, confirmation, sequential predictions, evidence, persistence, nudge integration, mobile cache and release gates each map to a task.
- Scope: production deployment, FCM physical proof and live charger availability remain explicit external gates rather than hidden assumptions.
- Type consistency: `DailyPlanDraft`, `DailyPlanResult`, `RouteNudge`, and outbox identifiers remain immutable across API and mobile.
- Placeholder scan: no TBD/TODO requirements; degraded behavior is explicit.
- Execution mode: inline, per the user's standing instruction.
