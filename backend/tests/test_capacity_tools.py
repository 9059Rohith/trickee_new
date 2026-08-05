from scripts.rollout_gate import day_passes, evaluate
from scripts.telemetry_load import build_schedule, deterministic_identity, telemetry_window
import importlib.util
from pathlib import Path


def test_schedule_prioritizes_live_and_sequences_are_unique():
    schedule = build_schedule(2, 3, backfill_devices=1, backfill_windows=200,
                              burst_windows_per_second=300)
    for second in {row.due_second for row in schedule}:
        modes = [row.mode for row in schedule if row.due_second == second]
        if "backfill" in modes:
            assert max(i for i, mode in enumerate(modes) if mode == "live") < modes.index("backfill")
    live = [row for row in schedule if row.mode == "live"]
    assert len(live) == 6
    keys = {(row.identity_index, sequence) for row in schedule for sequence in row.sequences}
    assert len(keys) == sum(len(row.sequences) for row in schedule)
    assert sum(len(row.sequences) for row in schedule if row.mode == "burst") == 300
    window = telemetry_window(deterministic_identity(0), 1, 1_000)
    assert window["sequence_no"] == 1
    assert window["gps"]["is_mock_location"] is True


def test_rollout_requires_capacity_headroom_and_three_consecutive_days():
    good = {"completeness_pct": 99.9, "max_backlog_age_s": 10, "battery_drain_pct_per_hour": 3,
            "rejection_pct": 0, "p95_live_latency_s": 1, "sev1_incidents": 0,
            "proven_windows_per_second": 225, "planned_windows_per_second": 150}
    assert day_passes(good)[0]
    assert not day_passes({**good, "proven_windows_per_second": 224})[0]
    records = [{**good, "cohort_size": 10, "date": f"2026-08-0{day}"} for day in (1, 2, 3)]
    result = evaluate(records)
    assert result["cohorts"]["10"]["passed"] is True
    assert result["cohorts"]["25"]["passed"] is False
    assert result["next_approved_cohort"] == 25


def test_gcp_topology_static_safety_checks_pass():
    script = Path(__file__).parents[2] / "infra" / "gcp" / "validate_architecture.py"
    spec = importlib.util.spec_from_file_location("validate_architecture", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.validate(script.parent) == []
