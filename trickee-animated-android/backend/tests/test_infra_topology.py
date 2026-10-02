from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra" / "gcp"))
from validate_architecture import validate


def test_reconciler_scheduler_runs_every_fifteen_minutes():
    root = Path(__file__).resolve().parents[2] / "infra" / "gcp"
    assert validate(root) == []
    assert 'schedule    = "*/15 * * * *"' in (root / "main.tf").read_text(encoding="utf-8")
