"""Prometheus metrics. Vehicle, trip, device, and coordinate labels are forbidden."""
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

INGESTED_WINDOWS = Counter("trickee_ingested_windows_total", "Canonical telemetry windows", ["result"])
INGEST_LATENCY = Histogram("trickee_ingest_latency_seconds", "Telemetry ingestion request latency")
OUTBOX_BACKLOG = Gauge("trickee_server_outbox_pending", "Pending canonical outbox rows")
PROCESSOR_FAILURES = Counter("trickee_processor_failures_total", "Processor failures", ["processor"])
WEBSOCKET_CONNECTIONS = Gauge("trickee_websocket_connections", "Open WebSocket connections")

ALLOWED_LABEL_NAMES = {"result", "processor"}


def validate_metric_privacy() -> None:
    collectors = [INGESTED_WINDOWS, INGEST_LATENCY, OUTBOX_BACKLOG, PROCESSOR_FAILURES, WEBSOCKET_CONNECTIONS]
    forbidden = {"vehicle_id", "trip_id", "device_id", "latitude", "longitude"}
    for collector in collectors:
        names = set(getattr(collector, "_labelnames", ()))
        if names & forbidden or not names <= ALLOWED_LABEL_NAMES:
            raise RuntimeError(f"unsafe metric labels: {sorted(names)}")


def render_metrics() -> tuple[bytes, str]:
    validate_metric_privacy()
    return generate_latest(), CONTENT_TYPE_LATEST
