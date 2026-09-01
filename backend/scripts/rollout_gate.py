"""Evaluate controlled rollout cohorts from daily evidence JSON."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

COHORTS = [10, 25, 50, 100, 150]
DEFAULT_THRESHOLDS = {
    "completeness_pct": (">=", 99.5),
    "max_backlog_age_s": ("<=", 300.0),
    "battery_drain_pct_per_hour": ("<=", 5.0),
    "rejection_pct": ("<=", 0.1),
    "p95_live_latency_s": ("<=", 3.0),
    "p99_live_latency_s": ("<=", 5.0),
    "p95_finalization_latency_s": ("<", 10.0),
    "backfill_60m_completion_s": ("<", 300.0),
    "sev1_incidents": ("<=", 0),
}


def day_passes(day: dict, thresholds: dict = DEFAULT_THRESHOLDS) -> tuple[bool, list[str]]:
    failures = []
    for metric, (operator, target) in thresholds.items():
        value = float(day.get(metric, float("-inf") if operator == ">=" else float("inf")))
        if operator == ">=":
            passed = value >= target
        elif operator == "<":
            passed = value < target
        else:
            passed = value <= target
        if not passed:
            failures.append(f"{metric} {value} violates {operator} {target}")
    capacity = float(day.get("proven_windows_per_second", 0))
    required = float(day.get("planned_windows_per_second", 0)) * 1.5
    if capacity < required:
        failures.append(f"capacity {capacity} is below 50% headroom requirement {required}")
    return not failures, failures


def evaluate(records: list[dict]) -> dict:
    by_cohort: dict[int, list[dict]] = defaultdict(list)
    for row in records:
        by_cohort[int(row["cohort_size"])].append(row)
    results = {}
    previous_passed = True
    for cohort in COHORTS:
        rows = sorted(by_cohort[cohort], key=lambda row: row["date"])
        last_three = rows[-3:]
        checks = [day_passes(row) for row in last_three]
        passed = previous_passed and len(last_three) == 3 and all(item[0] for item in checks)
        results[str(cohort)] = {"passed": passed, "days_evaluated": len(last_three),
                                "failures": [failure for _, failures in checks for failure in failures]}
        previous_passed = passed
    return {"cohorts": results, "next_approved_cohort": next((size for size in COHORTS if not results[str(size)]["passed"]), None)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate(json.loads(args.evidence.read_text(encoding="utf-8"))), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
