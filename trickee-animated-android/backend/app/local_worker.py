"""SQLite-only processor for the lightweight local Android pilot.

Production uses the Redis relay and separate consumers. This worker gives the
single-machine demo the same projections without pretending Redis is present.
"""
from __future__ import annotations

import time
from datetime import datetime

from app.database import SessionLocal, engine
from app.models.entities import ServerOutbox
from app.processors.imu_rules import process_imu_rules
from app.processors.live_state import project_live_state
from app.processors.trip_finalizer import finalize_trip


def process_pending_once() -> int:
    if engine.dialect.name != "sqlite":
        raise RuntimeError("The local worker is only for SQLite pilots")

    with SessionLocal() as db:
        rows = (
            db.query(ServerOutbox)
            .filter(ServerOutbox.state == "pending")
            .order_by(ServerOutbox.created_at, ServerOutbox.id)
            .limit(25)
            .all()
        )
        for row in rows:
            event = {"event_type": row.event_type, "payload": row.payload}
            try:
                project_live_state(db, event)
                process_imu_rules(db, event)
                finalize_trip(db, event)
                row.state = "dispatched"
                row.dispatched_at = datetime.utcnow()
                row.attempt_count += 1
                db.commit()
            except Exception:
                db.rollback()
                raise
        return len(rows)


def main() -> None:
    while True:
        if not process_pending_once():
            time.sleep(0.25)


if __name__ == "__main__":
    main()
