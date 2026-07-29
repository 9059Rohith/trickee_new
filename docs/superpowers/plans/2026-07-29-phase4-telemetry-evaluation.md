# Phase 4 Telemetry Evaluation and Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the published sparse, unit-corrected sparse, and synthetic one-second evaluations with guarded held-out calibration and no raw telemetry committed.

**Architecture:** Build a standalone backend evaluation package with explicit schema/unit configuration, deterministic sessionization and interpolation, metric reporting, and release gates. The package reads a caller-supplied dataset path and writes only aggregate reports under a git-ignored output directory.

**Tech Stack:** Python 3.12, PyArrow, pandas, NumPy, pytest, existing Trickee physics services.

## Global Constraints

- Pin dataset revision `b22ff79a2c5dbb4bf6210e37a468e3a724d540dd`.
- Never infer make/model/category from error ranking.
- Never label `power` as measured energy until documented.
- Synthetic points carry provenance and never invent altitude, accuracy, traffic, stops, or BMS fields.
- Raw Parquet and precise coordinates remain outside Git.

---

### Task 1: Evaluation dependencies and path safety

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `.gitignore`
- Create: `backend/app/evaluation/__init__.py`
- Create: `backend/tests/test_telemetry_evaluation.py`

**Interfaces:**
- Produces `resolve_dataset_path(path) -> Path` and rejects paths inside the repository for raw data writes.

- [ ] Write failing tests for missing paths, paired-file discovery, revision manifest, and output/raw-data Git safety.
- [ ] Run targeted pytest and confirm missing package failure.
- [ ] Add pinned `pandas`/`pyarrow` compatible with Python 3.12, ignore `evaluation-output/`, and implement path/manifest validation.
- [ ] Re-run targeted tests.
- [ ] Commit `build: add safe telemetry evaluation dependencies`.

### Task 2: Explicit dataset adapter

**Files:**
- Create: `backend/app/evaluation/ev_telemetry_adapter.py`
- Modify: `backend/tests/test_telemetry_evaluation.py`

**Interfaces:**
- Produces `TelemetryAdapter.load_vehicle(alias)`, `validate_schema`, and configured unit conversions.
- Returns immutable raw values plus normalized timestamps, `speed_mps`, coordinates, and provisional CAN comparison field.

- [ ] Write failing tests for required schemas, raw preservation, km/h conversion, rejection of unknown speed units, no `carbattery`-to-SOC mapping, and provisional `power` labelling.
- [ ] Run tests and confirm missing adapter failure.
- [ ] Implement adapter with explicit `TelemetryUnitConfig`.
- [ ] Re-run tests.
- [ ] Commit `feat: add explicit Evify telemetry adapter`.

### Task 3: Sessionization and one-second synthesis

**Files:**
- Create: `backend/app/evaluation/sessionization.py`
- Modify: `backend/tests/test_telemetry_evaluation.py`

**Interfaces:**
- Produces `infer_sessions(gps, can, config) -> list[EvaluationSession]`.
- Produces `interpolate_one_second(session) -> SyntheticTrack` with source interval IDs and `synthetic=True`.

- [ ] Write failing tests for 30-minute split, four-point minimum, 20-minute/12-hour duration, 10-minute CAN matching, endpoint preservation, one-second timestamps, monotonic interpolation, and no invented fields.
- [ ] Run tests and confirm missing module failure.
- [ ] Implement deterministic sessionization/interpolation.
- [ ] Re-run tests.
- [ ] Commit `feat: synthesize provenance-safe one-second tracks`.

### Task 4: Three-feed evaluator and metrics

**Files:**
- Create: `backend/app/evaluation/evaluator.py`
- Modify: `backend/tests/test_telemetry_evaluation.py`

**Interfaces:**
- Produces `evaluate_session(session, category, feed)` and aggregate MAE Wh, APE, bias, correlation, percentiles, accepted/rejected points.

- [ ] Write failing hand-calculated tests for published sparse, corrected sparse, synthetic feed, MAE, percentage error, signed bias, median, and percentiles.
- [ ] Run tests and confirm missing evaluator failure.
- [ ] Implement using existing physics functions without duplicating force equations.
- [ ] Re-run tests.
- [ ] Commit `feat: compare telemetry feed strategies`.

### Task 5: Held-out calibration and release gates

**Files:**
- Create: `backend/app/evaluation/calibration.py`
- Modify: `backend/tests/test_telemetry_evaluation.py`

**Interfaces:**
- Produces least-squares scale fitting, leave-one-vehicle-out evaluation, time split evaluation, and `CalibrationGateResult`.

- [ ] Write failing leakage tests proving the held-out alias is absent from fit data plus threshold tests for 20% median APE, 10% median bias, 35% per-vehicle maximum, 20 trips, documented units, and confirmed specs.
- [ ] Run tests and confirm missing calibration failure.
- [ ] Implement calibration and fail-closed gates.
- [ ] Re-run tests.
- [ ] Commit `feat: guard telemetry calibration with held-out gates`.

### Task 6: Reproducible command and aggregate report

**Files:**
- Create: `backend/scripts/evaluate_ev_telemetry.py`
- Create: `backend/tests/test_telemetry_evaluation.py`
- Modify: `DEVELOPER_HANDOFF.md`

**Interfaces:**
- CLI requires dataset path, revision, speed unit, comparison-field semantics, vehicle-spec mapping, and output path.
- Writes JSON/Markdown aggregate results without coordinates.

- [ ] Write failing CLI tests for required configuration, deterministic output, no coordinates, revision/config echo, and nonzero exit when release gates fail.
- [ ] Run tests and confirm missing script failure.
- [ ] Implement CLI and document exact invocation and limitations.
- [ ] Run targeted tests and execute against the local pinned snapshot.
- [ ] Commit `feat: add reproducible telemetry evaluation command`.

### Task 7: Phase 4 verification

- [ ] Run all backend tests and the evaluation command twice; compare report hashes.
- [ ] Confirm `git status` contains no Parquet, raw coordinates, caches, or local output.
- [ ] Confirm release gate remains failed until field semantics and vehicle mapping are supplied.
- [ ] Run full repository verification and check Phase 4 acceptance criteria.
