"""Durable FCM delivery for due notification-outbox rows."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

import google.auth
from google.auth.transport.requests import Request
import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.entities import Device, NotificationOutbox


FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


@dataclass(frozen=True)
class FcmDeliveryError(Exception):
    code: str
    detail: str
    permanent: bool = False


class FcmSender(Protocol):
    def send(self, *, token: str, title: str, body: str, data: dict[str, str], channel_id: str) -> str: ...


class GoogleFcmSender:
    def __init__(self, project_id: str | None = None):
        settings = get_settings()
        self.project_id = (project_id or settings.fcm_project_id).strip()
        self.timeout = settings.fcm_timeout_seconds
        if not self.project_id:
            raise RuntimeError("TRICKEE_FCM_PROJECT_ID is not configured")
        self.credentials, _ = google.auth.default(scopes=[FCM_SCOPE])

    def send(self, *, token: str, title: str, body: str, data: dict[str, str], channel_id: str) -> str:
        if not self.credentials.valid:
            self.credentials.refresh(Request())
        response = httpx.post(
            f"https://fcm.googleapis.com/v1/projects/{self.project_id}/messages:send",
            headers={"Authorization": f"Bearer {self.credentials.token}"},
            json={
                "message": {
                    "token": token,
                    # Data-only delivery ensures our FirebaseMessagingService
                    # uses the same high-priority channel and deep link in both
                    # foreground and background states.
                    "data": {**data, "title": title, "body": body},
                    "android": {
                        "priority": "HIGH",
                        "notification": {"channel_id": channel_id, "sound": "default"},
                    },
                }
            },
            timeout=self.timeout,
        )
        if response.is_success:
            return str(response.json().get("name") or "sent")
        detail = response.text[:255]
        code = f"HTTP_{response.status_code}"
        try:
            error = response.json().get("error") or {}
            code = str(error.get("status") or code)[:80]
            details = error.get("details") or []
            fcm_code = next(
                (
                    item.get("errorCode")
                    for item in details
                    if isinstance(item, dict) and item.get("errorCode")
                ),
                None,
            )
            if fcm_code:
                code = str(fcm_code)[:80]
        except ValueError:
            pass
        raise FcmDeliveryError(
            code=code,
            detail=detail,
            permanent=code in {"UNREGISTERED", "SENDER_ID_MISMATCH"},
        )


def _string_data(nudge: NotificationOutbox) -> dict[str, str]:
    raw: dict[str, Any] = {"nudge_id": nudge.id, "nudge_type": nudge.nudge_type, **(nudge.payload or {})}
    return {
        str(key): str(value).lower() if isinstance(value, bool) else str(value)
        for key, value in raw.items()
        if value is not None
    }


def dispatch_due_notifications(
    db: Session,
    *,
    sender: FcmSender,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int]:
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    retry_cutoff = now - timedelta(seconds=30)
    rows = (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.status == "pending",
            NotificationOutbox.due_at <= now,
            or_(NotificationOutbox.attempts == 0, NotificationOutbox.updated_at <= retry_cutoff),
        )
        .order_by(NotificationOutbox.due_at, NotificationOutbox.created_at)
        .limit(max(1, min(limit, 500)))
        .all()
    )
    stats = {"selected": len(rows), "sent": 0, "pending": 0, "failed": 0}
    for nudge in rows:
        expires_raw = (nudge.payload or {}).get("expires_at")
        if expires_raw:
            try:
                expires_at = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
                if expires_at.astimezone(timezone.utc).replace(tzinfo=None) <= now:
                    nudge.status = "failed"
                    nudge.failed_at = now
                    nudge.last_error_code = "EXPIRED"
                    nudge.last_error_detail = "Notification expired before provider delivery"
                    stats["failed"] += 1
                    continue
            except ValueError:
                pass
        devices = db.query(Device).filter(
            Device.registered_by_user_id == nudge.user_id,
            Device.is_active.is_(True),
            Device.revoked_at.is_(None),
            Device.fcm_registration_token.is_not(None),
        ).all()
        if not devices:
            nudge.last_error_code = "NO_ACTIVE_PUSH_TOKEN"
            nudge.last_error_detail = "Waiting for the signed-in handset to register FCM"
            nudge.updated_at = now
            stats["pending"] += 1
            continue
        message_ids: list[str] = []
        transient_error: FcmDeliveryError | None = None
        for device in devices:
            try:
                message_ids.append(
                    sender.send(
                        token=str(device.fcm_registration_token),
                        title=nudge.title,
                        body=nudge.body,
                        data=_string_data(nudge),
                        channel_id=str((nudge.payload or {}).get("android_channel_id") or "trickee_route_alerts_high"),
                    )
                )
            except FcmDeliveryError as error:
                if error.permanent:
                    device.fcm_registration_token = None
                    device.fcm_token_updated_at = None
                else:
                    transient_error = error
        nudge.attempts += 1
        if message_ids:
            nudge.status = "sent"
            nudge.sent_at = now
            nudge.last_error_code = None
            nudge.last_error_detail = ",".join(message_ids)[:255]
            stats["sent"] += 1
        else:
            error = transient_error or FcmDeliveryError("NO_VALID_PUSH_TOKEN", "All registered tokens were invalid")
            nudge.last_error_code = error.code[:80]
            nudge.last_error_detail = error.detail[:255]
            nudge.updated_at = now
            stats["pending"] += 1
    db.commit()
    return stats
