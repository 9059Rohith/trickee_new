"""Transactional-outbox relay. Redis failure always leaves PostgreSQL pending."""
from __future__ import annotations

from datetime import datetime
from sqlalchemy.orm import Session

from app.models.entities import ServerOutbox
from app.streams.redis_client import StreamClient, event_fields

STREAM = "telemetry:events"


def relay_once(db: Session, streams: StreamClient, limit: int = 100) -> int:
    rows = (
        db.query(ServerOutbox)
        .filter(ServerOutbox.state == "pending")
        .order_by(ServerOutbox.created_at, ServerOutbox.id)
        .with_for_update(skip_locked=True)
        .limit(limit)
        .all()
    )
    sent = 0
    for row in rows:
        row.attempt_count += 1
        try:
            streams.append(STREAM, event_fields(row.id, row.event_type, row.aggregate_id, row.payload))
        except Exception:
            db.rollback()
            raise
        row.state = "dispatched"
        row.dispatched_at = datetime.utcnow()
        db.commit()
        sent += 1
    return sent
