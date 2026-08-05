"""
Trickee GPS-First EV Intelligence — FastAPI application.

Health endpoint reports GPS-first model status.
No BMS fields are fabricated anywhere in this application.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, create_tables, get_db
from app.routers import auth, devices, experience, fleet_owner, gps_intelligence, mobile, soc, vehicles
from app.services.auth import get_current_user
from app.models.entities import User
from app.services.gps_retention import cleanup_expired_raw_samples

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_tables()
    db = SessionLocal()
    try:
        deleted = cleanup_expired_raw_samples(db)
        if deleted:
            logger.info("GPS retention cleanup removed %s raw samples", deleted)
    except Exception:
        logger.exception("GPS retention cleanup failed on startup")
    finally:
        db.close()
    async def retention_loop():
        while True:
            await asyncio.sleep(24 * 60 * 60)
            scheduled_db = SessionLocal()
            try:
                cleanup_expired_raw_samples(scheduled_db)
            except Exception:
                logger.exception("Scheduled GPS retention cleanup failed")
            finally:
                scheduled_db.close()

    retention_task = asyncio.create_task(retention_loop())
    try:
        yield
    finally:
        retention_task.cancel()
        try:
            await retention_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title=settings.app_name, version="2.0.0-gps-first", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(auth.v2_router)
app.include_router(devices.router)
app.include_router(mobile.router, prefix=settings.api_prefix)
app.include_router(gps_intelligence.router, prefix=settings.api_prefix)
app.include_router(soc.router, prefix=settings.api_prefix)
app.include_router(vehicles.router, prefix=settings.api_prefix)
app.include_router(experience.router, prefix=settings.api_prefix)
app.include_router(fleet_owner.router, prefix=settings.api_prefix)
# Contract-compatible v2 ingestion route; the legacy mobile-prefixed route is
# retained for existing app builds.
app.add_api_route(
    "/api/v2/trips/{trip_id}/gps-batch",
    mobile.upload_gps_batch,
    methods=["POST"],
    tags=["mobile"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "GPS-First v2.0",
        "model_type": "physics_baseline",
        "bms_model_active": False,
        "gps_model_active": True,
        "version": "2.0.0-gps-first",
        "retention_days": settings.gps_raw_retention_days,
    }


@app.post("/api/v1/admin/gps-retention/cleanup")
def run_gps_retention_cleanup(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manual retention cleanup trigger for ops / scheduled jobs."""
    if current_user.role not in {"admin", "fleet_admin"}:
        from fastapi import HTTPException, status
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    deleted = cleanup_expired_raw_samples(db)
    return {"deleted": deleted, "retention_days": settings.gps_raw_retention_days}
