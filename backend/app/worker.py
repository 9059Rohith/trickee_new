"""Long-running relay and processor roles."""
from __future__ import annotations

import os
import socket
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.database import SessionLocal
from app.processors.imu_rules import process_imu_rules
from app.processors.live_state import project_live_state
from app.processors.trip_finalizer import finalize_trip
from app.streams.consumer import consume_once
from app.streams.outbox_relay import relay_once
from app.streams.redis_client import RedisStreamClient


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
    streams = RedisStreamClient(os.environ["TRICKEE_REDIS_URL"])
    consumer = f"{socket.gethostname()}-{os.getpid()}"
    handlers = {
        "live-state": project_live_state,
        "imu-rules": process_imu_rules,
        "trip-finalizer": finalize_trip,
    }
    while True:
        db = SessionLocal()
        try:
            if role == "relay":
                work = relay_once(db, streams)
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
