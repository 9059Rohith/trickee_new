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
            "rejection_pct": 0, "p95_live_latency_s": 1, "p99_live_latency_s": 2,
            "p95_finalization_latency_s": 4, "backfill_60m_completion_s": 120,
            "sev1_incidents": 0,
            "proven_windows_per_second": 225, "planned_windows_per_second": 150}
    assert day_passes(good)[0]
    assert not day_passes({**good, "proven_windows_per_second": 224})[0]
    records = [{**good, "cohort_size": 10, "date": f"2026-08-0{day}"} for day in (1, 2, 3)]
    result = evaluate(records)
    assert result["cohorts"]["10"]["passed"] is True
    assert result["cohorts"]["25"]["passed"] is False
    assert result["next_approved_cohort"] == 25


def test_rollout_enforces_master_design_slos_and_fails_closed():
    good = {
        "completeness_pct": 99.5,
        "max_backlog_age_s": 299,
        "battery_drain_pct_per_hour": 5,
        "rejection_pct": 0.1,
        "p95_live_latency_s": 3,
        "p99_live_latency_s": 5,
        "p95_finalization_latency_s": 9.99,
        "backfill_60m_completion_s": 299,
        "sev1_incidents": 0,
        "proven_windows_per_second": 225,
        "planned_windows_per_second": 150,
    }
    assert day_passes(good)[0]

    violations = {
        "completeness_pct": 99.49,
        "battery_drain_pct_per_hour": 5.01,
        "p95_live_latency_s": 3.01,
        "p99_live_latency_s": 5.01,
        "p95_finalization_latency_s": 10,
        "backfill_60m_completion_s": 300,
    }
    for metric, value in violations.items():
        passed, failures = day_passes({**good, metric: value})
        assert not passed
        assert any(metric in failure for failure in failures)

    passed, failures = day_passes({key: value for key, value in good.items() if key != "p99_live_latency_s"})
    assert not passed
    assert any("p99_live_latency_s" in failure for failure in failures)


def test_gcp_topology_static_safety_checks_pass():
    script = Path(__file__).parents[2] / "infra" / "gcp" / "validate_architecture.py"
    spec = importlib.util.spec_from_file_location("validate_architecture", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.validate(script.parent) == []


def test_gcp_connector_and_outbox_alert_have_deployable_sources():
    main = (Path(__file__).parents[2] / "infra" / "gcp" / "main.tf").read_text(encoding="utf-8")

    assert 'ip_cidr_range            = "10.20.0.0/28"' in main
    assert 'resource "google_logging_metric" "outbox_pending"' in main
    assert 'jsonPayload.metric=\\"trickee_server_outbox_pending\\"' in main
    assert 'metric.type=\\"logging.googleapis.com/user/${google_logging_metric.outbox_pending.name}\\"' in main


def test_gcp_sql_metric_and_runtime_dependencies_match_provider_contracts():
    main = (Path(__file__).parents[2] / "infra" / "gcp" / "main.tf").read_text(encoding="utf-8")

    assert 'edition           = "ENTERPRISE"' in main
    assert 'metric_kind  = "DELTA"' in main
    assert 'value_type   = "DISTRIBUTION"' in main
    assert "bucket_options" in main
    assert "google_secret_manager_secret_version.database_url," in main
    assert "google_secret_manager_secret_iam_member.access," in main
    assert "google_secret_manager_secret_version.redis_ca," in main
    assert "ignore_changes = [scaling]" in main
    assert 'name  = "TRICKEE_PASSWORD_AUTH_ENABLED"' in main
    assert 'value = "false"' in main
