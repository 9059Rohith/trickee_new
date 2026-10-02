"""At-least-once Redis consumer with PostgreSQL processor idempotency."""
from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import ProcessorIdempotency
from app.streams.outbox_relay import STREAM
from app.streams.redis_client import StreamClient, StreamMessage

DEAD_LETTER_STREAM = "telemetry:dead-letter"
MAX_DELIVERIES = 5


def process_message(
    db: Session,
    streams: StreamClient,
    group: str,
    processor_name: str,
    message: StreamMessage,
    handler: Callable[[Session, dict], None],
) -> str:
    outbox_id = message.fields["outbox_id"]
    if db.query(ProcessorIdempotency).filter_by(processor_name=processor_name, outbox_id=outbox_id).first():
        streams.ack(STREAM, group, message.message_id)
        return "duplicate"
    try:
        handler(db, {**message.fields, "payload": json.loads(message.fields["payload"])})
        db.add(ProcessorIdempotency(processor_name=processor_name, outbox_id=outbox_id, processed_at=datetime.utcnow()))
        db.commit()
        streams.ack(STREAM, group, message.message_id)
        return "processed"
    except IntegrityError:
        db.rollback()
        streams.ack(STREAM, group, message.message_id)
        return "duplicate"
    except Exception as exc:
        db.rollback()
        if message.delivery_count >= MAX_DELIVERIES:
            streams.append(DEAD_LETTER_STREAM, {
                **message.fields,
                "processor": processor_name,
                "error": type(exc).__name__,
                "delivery_count": str(message.delivery_count),
            })
            streams.ack(STREAM, group, message.message_id)
            return "dead_lettered"
        return "retry"


def consume_once(db: Session, streams: StreamClient, group: str, consumer: str, processor_name: str,
                 handler: Callable[[Session, dict], None], count: int = 100) -> list[str]:
    streams.ensure_group(STREAM, group)
    messages = streams.reclaim(STREAM, group, consumer, 60_000, count)
    if not messages:
        messages = streams.read(STREAM, group, consumer, count, 1000)
    return [process_message(db, streams, group, processor_name, item, handler) for item in messages]
