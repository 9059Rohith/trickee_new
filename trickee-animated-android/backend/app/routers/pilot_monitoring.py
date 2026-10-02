from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.api import ok
from app.services.monitoring_identity import MonitoringCaller, require_monitoring_caller
from app.services.pilot_monitoring import build_pilot_monitoring_snapshot


router = APIRouter(prefix="/api/v2/internal", tags=["pilot-monitoring"])


@router.get("/pilot-monitoring")
def pilot_monitoring_snapshot(
    db: Session = Depends(get_db),
    _caller: MonitoringCaller = Depends(require_monitoring_caller),
):
    return ok(build_pilot_monitoring_snapshot(db))
