"""Long-running relay and processor roles."""
from __future__ import annotations

import json
import os
import socket
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.database import SessionLocal
from app.models.entities import ServerOutbox
from app.processors.imu_rules import process_imu_rules
from app.processors.live_state import project_live_state
from app.processors.trip_finalizer import finalize_trip
from app.streams.consumer import consume_once
from app.streams.outbox_relay import relay_once
from app.streams.redis_client import RedisStreamClient


def run_notification_cycle(db, *, sender, tools, now=None) -> dict:
    """Evaluate live guidance without allowing provider failures to stop delivery."""
    from app.services.fcm_notifications import dispatch_due_notifications
    from app.services.live_trip_nudges import evaluate_active_trip_nudges

    evaluation_error = None
    try:
        evaluation = evaluate_active_trip_nudges(db, tools=tools, now=now)
    except Exception as exc:
        db.rollback()
        evaluation = {"scanned": 0, "eligible": 0, "queued": 0, "provider_errors": 0}
        evaluation_error = type(exc).__name__
    delivery = dispatch_due_notifications(db, sender=sender, now=now)
    return {"evaluation": evaluation, "evaluation_error": evaluation_error, "delivery": delivery}


def outbox_metric_record(pending: int) -> dict[str, str | int]:
    """Build the low-cardinality structured log consumed by Cloud Monitoring."""
    return {
        "severity": "INFO",
        "metric": "trickee_server_outbox_pending",
        "outbox_pending": pending,
    }


def _start_health_server() -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","role":"telemetry-worker"}')

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8000"))), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


def run(role: str) -> None:
    _start_health_server()
    if role == "notification-fcm":
        from app.services.fcm_notifications import GoogleFcmSender, dispatch_due_notifications
        from app.services.daily_plan_tools import daily_plan_tools

        sender = GoogleFcmSender()
        next_evaluation_at = 0.0
        while True:
            db = SessionLocal()
            try:
                if time.monotonic() >= next_evaluation_at:
                    summary = run_notification_cycle(db, sender=sender, tools=daily_plan_tools)
                    print(json.dumps({"severity": "INFO", "metric": "trickee_notification_cycle", **summary}, separators=(",", ":")), flush=True)
                    work = summary["delivery"]["selected"]
                    next_evaluation_at = time.monotonic() + 60.0
                else:
                    work = dispatch_due_notifications(db, sender=sender)["selected"]
            finally:
                db.close()
            # A pending row without an active token is still selected; never spin
            # through the same undeliverable row without a pause.
            time.sleep(1.0 if work else 5.0)
        return
    streams = RedisStreamClient(os.environ["TRICKEE_REDIS_URL"])
    consumer = f"{socket.gethostname()}-{os.getpid()}"
    handlers = {
        "live-state": project_live_state,
        "imu-rules": process_imu_rules,
        "trip-finalizer": finalize_trip,
    }
    next_outbox_metric_at = 0.0
    while True:
        db = SessionLocal()
        try:
            if role == "relay":
                work = relay_once(db, streams)
                now = time.monotonic()
                if now >= next_outbox_metric_at:
                    pending = db.query(ServerOutbox).filter(ServerOutbox.state == "pending").count()
                    print(json.dumps(outbox_metric_record(pending), separators=(",", ":")), flush=True)
                    next_outbox_metric_at = now + 60.0
            else:
                handler = handlers[role]
                if role == "live-state":
                    wrapped = lambda session, event: handler(session, event, streams)
                else:
                    wrapped = handler
                work = len(consume_once(db, streams, f"telemetry-{role}", consumer, role, wrapped))
        finally:
            db.close()
        if not work:
            time.sleep(0.25)
