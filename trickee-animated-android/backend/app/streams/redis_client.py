"""Small Redis Streams adapter so recovery logic remains unit-testable."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Protocol

from redis import Redis
from redis.exceptions import ResponseError


@dataclass(frozen=True)
class StreamMessage:
    message_id: str
    fields: dict[str, str]
    delivery_count: int = 1


class StreamClient(Protocol):
    def append(self, stream: str, fields: dict[str, str]) -> str: ...
    def ensure_group(self, stream: str, group: str) -> None: ...
    def read(self, stream: str, group: str, consumer: str, count: int, block_ms: int) -> list[StreamMessage]: ...
    def reclaim(self, stream: str, group: str, consumer: str, idle_ms: int, count: int) -> list[StreamMessage]: ...
    def ack(self, stream: str, group: str, message_id: str) -> None: ...
    def publish(self, channel: str, payload: str) -> None: ...


class RedisStreamClient:
    def __init__(self, url: str):
        options = {}
        if url.startswith("rediss://"):
            ca_path = os.getenv("TRICKEE_REDIS_CA_CERT")
            if not ca_path:
                raise RuntimeError("TRICKEE_REDIS_CA_CERT is required for TLS Redis")
            options["ssl_ca_certs"] = ca_path
        self.redis = Redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=5,
            socket_connect_timeout=5,
            **options,
        )

    def append(self, stream: str, fields: dict[str, str]) -> str:
        return str(self.redis.xadd(stream, fields))

    def ensure_group(self, stream: str, group: str) -> None:
        try:
            self.redis.xgroup_create(stream, group, id="0", mkstream=True)
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    def read(self, stream: str, group: str, consumer: str, count: int = 100, block_ms: int = 1000) -> list[StreamMessage]:
        rows = self.redis.xreadgroup(group, consumer, {stream: ">"}, count=count, block=block_ms)
        return [StreamMessage(message_id, fields) for _, messages in rows for message_id, fields in messages]

    def reclaim(self, stream: str, group: str, consumer: str, idle_ms: int = 60_000, count: int = 100) -> list[StreamMessage]:
        _, rows, _ = self.redis.xautoclaim(stream, group, consumer, idle_ms, "0-0", count=count)
        pending = {
            str(row["message_id"]): int(row["times_delivered"])
            for row in self.redis.xpending_range(stream, group, "-", "+", count)
        }
        return [StreamMessage(message_id, fields, int(pending.get(message_id, 1))) for message_id, fields in rows]

    def ack(self, stream: str, group: str, message_id: str) -> None:
        self.redis.xack(stream, group, message_id)

    def publish(self, channel: str, payload: str) -> None:
        self.redis.publish(channel, payload)


def event_fields(outbox_id: str, event_type: str, aggregate_id: str, payload: dict) -> dict[str, str]:
    return {
        "outbox_id": outbox_id,
        "event_type": event_type,
        "aggregate_id": aggregate_id,
        "payload": json.dumps(payload, sort_keys=True, separators=(",", ":")),
    }
