from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra" / "gcp"))
from validate_architecture import validate


def test_reconciler_scheduler_runs_every_fifteen_minutes():
    root = Path(__file__).resolve().parents[2] / "infra" / "gcp"
    assert validate(root) == []
    assert 'schedule    = "*/15 * * * *"' in (root / "main.tf").read_text(encoding="utf-8")


def test_recurring_plan_worker_is_a_singleton_database_worker():
    root = Path(__file__).resolve().parents[2] / "infra" / "gcp"
    main = (root / "main.tf").read_text(encoding="utf-8")
    variables = (root / "variables.tf").read_text(encoding="utf-8")
    normalized_main = " ".join(main.split())
    normalized_variables = " ".join(variables.split())
    assert 'recurring-plans = { command = "recurring-plans", max = 1' in normalized_main
    assert 'recurring-plans = toset(["database-url"])' in normalized_variables
