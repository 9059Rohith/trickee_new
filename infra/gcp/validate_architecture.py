"""Static safety checks for the committed production topology."""
from pathlib import Path


def validate(root: Path) -> list[str]:
    text = "\n".join(path.read_text(encoding="utf-8") for path in root.glob("*.tf"))
    normalized = " ".join(text.split())
    required = {
        "private archive bucket": 'public_access_prevention = "enforced"',
        "uniform bucket access": "uniform_bucket_level_access = true",
        "HA Cloud SQL": 'availability_type = "REGIONAL"',
        "PITR": "point_in_time_recovery_enabled = true",
        "HA Redis": 'tier = "STANDARD_HA"',
        "bounded API scale": "api_max_instances",
        "bounded database pool": "TRICKEE_DB_MAX_OVERFLOW",
        "separate service accounts": 'for_each = local.roles',
        "dedicated migration job": 'toset(["migrate", "archive", "retention"])',
        "private SQL": "ipv4_enabled = false",
        "immutable image guidance": "@sha256:",
        "alert notification channel": "monitoring_notification_channels",
    }
    return [name for name, marker in required.items() if " ".join(marker.split()) not in normalized]


if __name__ == "__main__":
    missing = validate(Path(__file__).parent)
    if missing:
        raise SystemExit("Unsafe/incomplete topology: " + ", ".join(missing))
    print("GCP topology static checks passed")
