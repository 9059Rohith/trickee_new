"""
GPS raw sample retention cleanup (§6.5 / §9.2).

Configurable retention window. Does NOT delete validated samples or features.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.entities import GPSRawSample


def cleanup_expired_raw_samples(db: Session) -> int:
    """Delete GPS raw samples older than the configured retention window.
    Returns count of deleted rows."""
    settings = get_settings()
    cutoff = datetime.utcnow() - timedelta(days=settings.gps_raw_retention_days)
    count = (
        db.query(GPSRawSample)
        .filter(GPSRawSample.received_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return count
