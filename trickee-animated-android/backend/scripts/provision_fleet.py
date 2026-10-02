"""Provision Google-login fleet identities from a private JSON document."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.database import SessionLocal
from app.services.provisioning import FleetProvisionRequest, provision_fleet


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Idempotently provision fleet, vehicle, driver, and Google-login records."
    )
    parser.add_argument("input", type=Path, help="Private provisioning JSON; do not commit it")
    args = parser.parse_args()
    request = FleetProvisionRequest.model_validate_json(args.input.read_text(encoding="utf-8"))
    with SessionLocal() as db:
        result = provision_fleet(db, request)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
