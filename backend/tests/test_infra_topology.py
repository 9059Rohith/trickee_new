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


def test_route_guidance_worker_is_bounded_with_database_and_maps_access():
    root = Path(__file__).resolve().parents[2] / "infra" / "gcp"
    main = " ".join((root / "main.tf").read_text(encoding="utf-8").split())
    iam = " ".join((root / "iam.tf").read_text(encoding="utf-8").split())
    variables = " ".join((root / "variables.tf").read_text(encoding="utf-8").split())
    assert 'route-guidance = { command = "route-guidance", max = 1' in main
    assert 'route-guidance = toset(["database-url"])' in variables
    assert 'contains(["api", "notification-fcm", "route-guidance"], each.key)' in main
    assert 'for_each = toset(["api", "route-guidance"])' in iam
    assert 'resource "google_secret_manager_secret_iam_member" "notification_maps_reader"' in iam


def test_api_ai_and_maps_runtime_configuration_is_preserved_by_terraform():
    root = Path(__file__).resolve().parents[2] / "infra" / "gcp"
    main = " ".join((root / "main.tf").read_text(encoding="utf-8").split())
    iam = " ".join((root / "iam.tf").read_text(encoding="utf-8").split())
    assert 'name = "TRICKEE_GROQ_API_KEY"' in main
    assert 'secret = "trickee-groq-api-key"' in main
    assert 'name = "TRICKEE_GROQ_MODEL" value = "openai/gpt-oss-20b"' in main
    assert 'member = "serviceAccount:${google_service_account.role["api"].email}"' in iam
