"""
Vehicle specs router — update specs, check completeness.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import User, Vehicle
from app.schemas.api import ok
from app.services.auth import get_current_user
from app.services.vehicle_specs import is_prediction_spec_complete

router = APIRouter(prefix="/vehicles", tags=["vehicles"])

class VehicleSpecUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: str | None = None
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    usable_kwh: float | None = None
    rated_ah: float | None = None
    battery_chemistry: str | None = None
    nominal_voltage: float | None = None
    motor_kw: float | None = None
    kerb_weight: float | None = None
    gvw: float | None = None
    payload_capacity: float | None = None
    top_speed: float | None = None
    regen_available: bool | None = None
    certified_range: float | None = None
    max_range_km: float | None = None
    battery_capacity_kwh: float | None = None


class VehicleCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicle_code: str = Field(max_length=50)
    make: str = Field(max_length=100)
    model: str = Field(max_length=100)
    category: str | None = None
    variant: str | None = None
    usable_kwh: float | None = None
    rated_ah: float | None = None
    battery_chemistry: str = "LFP"
    nominal_voltage: float | None = None
    motor_kw: float | None = None
    kerb_weight: float | None = None
    gvw: float | None = None
    payload_capacity: float | None = None
    top_speed: float | None = None
    regen_available: bool | None = None
    certified_range: float | None = None
    max_range_km: float = 85.0
    battery_capacity_kwh: float = 1.824


def _check_spec_complete(v: Vehicle) -> bool:
    return is_prediction_spec_complete(v)


def _vehicle_dict(v: Vehicle) -> dict:
    return {
        "id": v.id, "fleet_id": v.fleet_id, "vehicle_code": v.vehicle_code,
        "make": v.make, "model": v.model, "category": v.category, "variant": v.variant,
        "battery_capacity_kwh": v.battery_capacity_kwh, "max_range_km": v.max_range_km,
        "battery_chemistry": v.battery_chemistry, "usable_kwh": v.usable_kwh,
        "rated_ah": v.rated_ah, "nominal_voltage": v.nominal_voltage,
        "motor_kw": v.motor_kw, "kerb_weight": v.kerb_weight, "gvw": v.gvw,
        "payload_capacity": v.payload_capacity, "top_speed": v.top_speed,
        "regen_available": v.regen_available, "certified_range": v.certified_range,
        "spec_incomplete": v.spec_incomplete, "is_active": v.is_active,
        "manufacture_year": v.manufacture_year,
    }


@router.get("/")
def list_vehicles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vehicles = db.query(Vehicle).filter(Vehicle.is_active == True).all()
    return ok([_vehicle_dict(v) for v in vehicles])


@router.get("/{vehicle_id}")
def get_vehicle(
    vehicle_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    return ok(_vehicle_dict(v))


@router.post("/")
def create_vehicle(
    body: VehicleCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fleet_id = current_user.fleet_id
    if not fleet_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User has no fleet")

    v = Vehicle(
        fleet_id=fleet_id,
        vehicle_code=body.vehicle_code,
        make=body.make,
        model=body.model,
        category=body.category,
        variant=body.variant,
        usable_kwh=body.usable_kwh,
        rated_ah=body.rated_ah,
        battery_chemistry=body.battery_chemistry,
        nominal_voltage=body.nominal_voltage,
        motor_kw=body.motor_kw,
        kerb_weight=body.kerb_weight,
        gvw=body.gvw,
        payload_capacity=body.payload_capacity,
        top_speed=body.top_speed,
        regen_available=body.regen_available,
        certified_range=body.certified_range,
        max_range_km=body.max_range_km,
        battery_capacity_kwh=body.battery_capacity_kwh,
    )
    v.spec_incomplete = not _check_spec_complete(v)
    db.add(v)
    db.commit()
    db.refresh(v)
    return ok(_vehicle_dict(v), "Vehicle created")


@router.patch("/{vehicle_id}/specs")
def update_vehicle_specs(
    vehicle_id: str,
    body: VehicleSpecUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")

    for field_name, value in body.model_dump(exclude_unset=True).items():
        setattr(v, field_name, value)

    v.spec_incomplete = not _check_spec_complete(v)
    db.commit()
    db.refresh(v)
    return ok(_vehicle_dict(v), "Vehicle specs updated" + (" (complete)" if not v.spec_incomplete else " (still incomplete)"))
