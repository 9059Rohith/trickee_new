import json
from dataclasses import replace
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import ProcessorIdempotency, ServerOutbox
from app.streams.consumer import consume_once, process_message
from app.streams.outbox_relay import relay_once
from app.streams.redis_client import StreamMessage


class FakeStreams:
    def __init__(self, fail=False):
        self.fail = fail
        self.rows = []
        self.acks = []
        self.reclaimed = []
        self.read_called = False
    def append(self, stream, fields):
        if self.fail: raise ConnectionError("redis unavailable")
        self.rows.append((stream, fields)); return str(len(self.rows))
    def ack(self, stream, group, message_id): self.acks.append(message_id)
    def publish(self, channel, payload): pass
    def ensure_group(self, stream, group): pass
    def read(self, *args):
        self.read_called = True
        return []
    def reclaim(self, *args): return self.reclaimed


def db_session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'stream.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_relay_marks_dispatched_only_after_stream_append(tmp_path):
    db = db_session(tmp_path)
    row = ServerOutbox(event_type="test", aggregate_type="trip", aggregate_id="t", payload={"x": 1})
    db.add(row); db.commit()
    failing = FakeStreams(fail=True)
    try: relay_once(db, failing)
    except ConnectionError: pass
    db.expire_all()
    assert db.query(ServerOutbox).one().state == "pending"
    assert relay_once(db, FakeStreams()) == 1
    assert db.query(ServerOutbox).one().state == "dispatched"


def test_processor_is_idempotent_and_poison_message_dead_letters(tmp_path):
    db = db_session(tmp_path); streams = FakeStreams(); called = []
    message = StreamMessage("1-0", {"outbox_id": "o1", "event_type": "x", "aggregate_id": "t", "payload": "{}"})
    assert process_message(db, streams, "g", "p", message, lambda _db, event: called.append(event)) == "processed"
    assert process_message(db, streams, "g", "p", message, lambda _db, event: called.append(event)) == "duplicate"
    assert len(called) == 1 and db.query(ProcessorIdempotency).count() == 1
    poison = replace(message, message_id="2-0", delivery_count=5,
                     fields={**message.fields, "outbox_id": "o2"})
    assert process_message(db, streams, "g", "p", poison, lambda *_: (_ for _ in ()).throw(ValueError())) == "dead_lettered"
    assert streams.rows[-1][0] == "telemetry:dead-letter"


def test_consumer_reclaims_stale_pending_before_reading_new_messages(tmp_path):
    db = db_session(tmp_path)
    streams = FakeStreams()
    streams.reclaimed = [StreamMessage(
        "3-0",
        {"outbox_id": "reclaimed", "event_type": "x", "aggregate_id": "t", "payload": "{}"},
        delivery_count=2,
    )]
    handled = []
    result = consume_once(db, streams, "group", "consumer", "processor", lambda _db, event: handled.append(event))
    assert result == ["processed"]
    assert handled[0]["outbox_id"] == "reclaimed"
    assert streams.read_called is False
