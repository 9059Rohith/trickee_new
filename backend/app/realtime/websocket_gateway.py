"""Fleet-isolated current-state API and snapshot-based WebSocket recovery."""
from __future__ import annotations

import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, get_db
from app.models.entities import User, Vehicle, VehicleLiveStateSnapshot
from app.observability.metrics import WEBSOCKET_CONNECTIONS
from app.processors.live_state import snapshot_dict
from app.schemas.api import ok
from app.services.auth import get_current_user

router = APIRouter(tags=["realtime"])


def _authorized_state(db: Session, user: User, vehicle_id: str) -> VehicleLiveStateSnapshot:
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id, Vehicle.fleet_id == user.fleet_id).first()
    if vehicle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    state = db.query(VehicleLiveStateSnapshot).filter_by(vehicle_id=vehicle_id).first()
    if state is None:
        state = VehicleLiveStateSnapshot(vehicle_id=vehicle_id)
    return state


@router.get("/api/v2/vehicles/{vehicle_id}/live-state")
def live_state(vehicle_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(snapshot_dict(_authorized_state(db, user, vehicle_id)))


def _websocket_user(db: Session, token: str) -> User | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
    if payload.get("typ") not in {None, "user"}:
        return None
    return db.query(User).filter(User.id == payload.get("sub"), User.is_active.is_(True)).first()


@router.websocket("/ws/v2/vehicles/{vehicle_id}")
async def vehicle_socket(websocket: WebSocket, vehicle_id: str, token: str = Query(...), since_version: int = 0):
    db = SessionLocal()
    try:
        user = _websocket_user(db, token)
        if user is None:
            await websocket.close(code=4401)
            return
        try:
            state = _authorized_state(db, user, vehicle_id)
        except HTTPException:
            await websocket.close(code=4404)
            return
        await websocket.accept()
        WEBSOCKET_CONNECTIONS.inc()
        sent_version = since_version
        while True:
            db.expire_all()
            current = db.query(VehicleLiveStateSnapshot).filter_by(vehicle_id=vehicle_id).first() or state
            if current.state_version != sent_version:
                await websocket.send_json({
                    "type": "snapshot" if current.state_version > sent_version + 1 else "update",
                    "data": snapshot_dict(current),
                })
                sent_version = current.state_version
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=1)
                if message == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                continue
    except WebSocketDisconnect:
        pass
    finally:
        WEBSOCKET_CONNECTIONS.dec()
        db.close()
