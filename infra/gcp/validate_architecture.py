"""Static safety checks for the committed production topology."""
from pathlib import Path


def validate(root: Path) -> list[str]:
    text = "\n".join(path.read_text(encoding="utf-8") for path in root.glob("*.tf"))
    normalized = " ".join(text.split())
    required = {
        "private archive bucket": 'public_access_prevention = "enforced"',
        "uniform bucket access": "uniform_bucket_level_access = true",
        "HA Cloud SQL": 'availability_type = "REGIONAL"',
        "explicit Cloud SQL edition": 'edition = "ENTERPRISE"',
        "PITR": "point_in_time_recovery_enabled = true",
        "HA Redis": 'tier = "STANDARD_HA"',
        "bounded API scale": "api_max_instances",
        "bounded database pool": "TRICKEE_DB_MAX_OVERFLOW",
        "separate service accounts": 'for_each = local.roles',
        "dedicated migration job": 'toset(["migrate", "archive", "retention", "finalization-reconciler"])',
        "scheduled incomplete reconciliation": 'resource "google_cloud_scheduler_job" "finalization_reconciler"',
        "15 minute reconciliation schedule": 'schedule = "*/15 * * * *"',
        "private SQL": "ipv4_enabled = false",
        "connector /28 subnet": 'ip_cidr_range = "10.20.0.0/28"',
        "immutable image guidance": "@sha256:",
        "alert notification channel": "monitoring_notification_channels",
        "extractable outbox log metric": 'resource "google_logging_metric" "outbox_pending"',
        "distribution outbox metric": 'value_type = "DISTRIBUTION"',
        "outbox metric alert dependency": "depends_on = [google_logging_metric.outbox_pending]",
        "runtime database secret ordering": "google_secret_manager_secret_version.database_url,",
        "runtime secret IAM ordering": "google_secret_manager_secret_iam_member.access,",
        "Cloud Run default drift guard": "ignore_changes = [scaling]",
        "explicit secret access map": "secret_access = {",
    }
    missing = [name for name, marker in required.items() if " ".join(marker.split()) not in normalized]
    forbidden = {
        "all-role/all-secret grants": "setproduct(local.roles",
    }
    unsafe = [name for name, marker in forbidden.items() if marker in normalized]
    return missing + unsafe


if __name__ == "__main__":
    missing = validate(Path(__file__).parent)
    if missing:
        raise SystemExit("Unsafe/incomplete topology: " + ", ".join(missing))
    print("GCP topology static checks passed")
