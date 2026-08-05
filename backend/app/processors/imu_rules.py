"""Conservative IMU quality and driving-event rules with explicit confidence."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.entities import TelemetryEvent, TelemetryWindow


def classify_window(window: TelemetryWindow) -> list[dict]:
    imu = window.imu_payload
    quality = min(float(imu.get("accelerometer_complete_pct", 0)), float(imu.get("gyroscope_complete_pct", 0)))
    if quality < 70:
        return [{"event_type": "IMU_LOW_QUALITY", "severity": "warning", "confidence": quality / 100}]
    events: list[dict] = []
    jerk = float(imu.get("jerk_max_mps3", 0))
    magnitude = float(imu.get("accel_magnitude_max_mps2", 0))
    if jerk >= 8:
        events.append({"event_type": "ABRUPT_MOTION_PROXY", "severity": "warning", "confidence": min(0.95, quality / 100)})
    if magnitude >= 18:
        events.append({"event_type": "HIGH_ACCELERATION_MAGNITUDE", "severity": "critical", "confidence": min(0.95, quality / 100)})
    return events


def process_imu_rules(db: Session, event: dict) -> None:
    if event.get("event_type") != "telemetry.batch_committed":
        return
    payload = event["payload"]
    trip_id = payload["trip_id"]
    windows = db.query(TelemetryWindow).filter(TelemetryWindow.trip_id == trip_id).all()
    for window in windows:
        for detected in classify_window(window):
            exists = db.query(TelemetryEvent).filter_by(
                processor_name="imu_rules", source_sample_id=window.sample_id, event_type=detected["event_type"]
            ).first()
            if not exists:
                db.add(TelemetryEvent(
                    vehicle_id=window.vehicle_id,
                    trip_id=window.trip_id,
                    source_sample_id=window.sample_id,
                    processor_name="imu_rules",
                    payload={"rule_version": 1, "estimated": True, "source": "phone_imu"},
                    **detected,
                ))
