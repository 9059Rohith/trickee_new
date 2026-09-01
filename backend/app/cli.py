"""One-image process-role entrypoint for Cloud Run and local Compose."""
from __future__ import annotations

import argparse
import json
import os
import subprocess


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=["api", "websocket", "relay", "live-state", "imu-rules", "trip-finalizer", "finalization-reconciler", "migrate", "archive", "retention", "provision"])
    args = parser.parse_args()
    port = os.getenv("PORT", "8000")
    if args.role in {"api", "websocket"}:
        workers = "1" if args.role == "websocket" else os.getenv("WEB_CONCURRENCY", "2")
        application = "app.realtime.socket_app:app" if args.role == "websocket" else "app.main:app"
        subprocess.run([
            "uvicorn", application, "--host", "0.0.0.0", "--port", port,
            "--workers", workers, "--proxy-headers",
        ], check=True)
    elif args.role == "migrate":
        subprocess.run(["alembic", "upgrade", "head"], check=True)
    elif args.role == "retention":
        from app.database import SessionLocal
        from app.services.gps_retention import cleanup_expired_raw_samples
        with SessionLocal() as db:
            cleanup_expired_raw_samples(db)
    elif args.role == "archive":
        from app.archive.job import archive_trip
        from app.database import SessionLocal
        trip_id = os.environ.get("TRICKEE_ARCHIVE_TRIP_ID")
        bucket = os.environ.get("TRICKEE_ARCHIVE_BUCKET")
        if not trip_id or not bucket:
            raise SystemExit("TRICKEE_ARCHIVE_TRIP_ID and TRICKEE_ARCHIVE_BUCKET are required")
        with SessionLocal() as db:
            archive_trip(db, bucket, trip_id)
    elif args.role == "provision":
        from app.database import SessionLocal
        from app.services.provisioning import FleetProvisionRequest, provision_fleet

        raw_request = os.environ.get("TRICKEE_PROVISIONING_JSON")
        if not raw_request:
            raise SystemExit("TRICKEE_PROVISIONING_JSON is required")
        request = FleetProvisionRequest.model_validate_json(raw_request)
        with SessionLocal() as db:
            result = provision_fleet(db, request)
        print(json.dumps(result, sort_keys=True))
    elif args.role == "finalization-reconciler":
        from app.config import get_settings
        from app.database import SessionLocal
        from app.services.incomplete_trip_reconciler import reconcile_incomplete_finalizations

        with SessionLocal() as db:
            reconciled = reconcile_incomplete_finalizations(
                db,
                timeout_hours=get_settings().incomplete_finalization_timeout_hours,
            )
        print(json.dumps({"reconciled_trip_ids": reconciled}, sort_keys=True))
    else:
        from app.worker import run
        run(args.role)


if __name__ == "__main__":
    main()
