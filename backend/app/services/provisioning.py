"""Idempotent, password-free fleet provisioning for Google-authenticated users."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.models.entities import Driver, Fleet, User, Vehicle
from app.services.vehicle_specs import is_prediction_spec_complete


class StrictProvisionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FleetProvision(StrictProvisionModel):
    name: str = Field(min_length=1, max_length=255)
    city: str = Field(min_length=1, max_length=100)


class VehicleProvision(StrictProvisionModel):
    vehicle_code: str = Field(min_length=1, max_length=50)
    make: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=50)
    variant: str | None = Field(default=None, max_length=100)
    usable_kwh: float = Field(gt=0)
    kerb_weight: float = Field(gt=0)
    regen_available: bool
    certified_range: float = Field(gt=0)
    battery_chemistry: str = Field(default="Unknown", min_length=1, max_length=20)
    nominal_voltage: float | None = Field(default=None, gt=0)
    motor_kw: float | None = Field(default=None, gt=0)
    top_speed: float | None = Field(default=None, gt=0)
    manufacture_year: int = Field(default=2024, ge=1900, le=2100)


class DriverProvision(StrictProvisionModel):
    email: str = Field(min_length=3, max_length=255)
    driver_code: str = Field(min_length=1, max_length=50)
    full_name: str = Field(min_length=1, max_length=255)
    assigned_vehicle_code: str = Field(min_length=1, max_length=50)
    phone: str | None = Field(default=None, max_length=20)
    style_label: str = Field(default="Moderate", max_length=50)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1:
            raise ValueError("email must be valid")
        return normalized


class AdminProvision(StrictProvisionModel):
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1:
            raise ValueError("email must be valid")
        return normalized


class FleetProvisionRequest(StrictProvisionModel):
    fleet: FleetProvision
    vehicles: list[VehicleProvision] = Field(min_length=1)
    drivers: list[DriverProvision] = Field(min_length=1)
    admins: list[AdminProvision] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_references(self) -> "FleetProvisionRequest":
        vehicle_codes = [vehicle.vehicle_code for vehicle in self.vehicles]
        if len(vehicle_codes) != len(set(vehicle_codes)):
            raise ValueError("vehicle_code must be unique")
        assignments = [driver.assigned_vehicle_code for driver in self.drivers]
        if len(assignments) != len(set(assignments)):
            raise ValueError("each vehicle may be assigned once")
        undeclared = set(assignments).difference(vehicle_codes)
        if undeclared:
            raise ValueError(f"assigned vehicle is not declared: {sorted(undeclared)}")
        emails = [driver.email for driver in self.drivers] + [admin.email for admin in self.admins]
        if len(emails) != len(set(emails)):
            raise ValueError("user email must be unique")
        driver_codes = [driver.driver_code for driver in self.drivers]
        if len(driver_codes) != len(set(driver_codes)):
            raise ValueError("driver_code must be unique")
        return self


def _require_same_fleet(entity_fleet_id: str, fleet_id: str, label: str) -> None:
    if entity_fleet_id != fleet_id:
        raise ValueError(f"{label} already belongs to another fleet")


def provision_fleet(db: Session, request: FleetProvisionRequest) -> dict:
    """Upsert a fleet atomically without creating passwords or Google subjects."""
    try:
        fleet = db.query(Fleet).filter(Fleet.name == request.fleet.name).first()
        if fleet is None:
            fleet = Fleet(name=request.fleet.name, city=request.fleet.city)
            db.add(fleet)
            db.flush()
        fleet.city = request.fleet.city

        vehicles: dict[str, Vehicle] = {}
        for item in request.vehicles:
            vehicle = db.query(Vehicle).filter(Vehicle.vehicle_code == item.vehicle_code).first()
            if vehicle is None:
                vehicle = Vehicle(fleet_id=fleet.id, vehicle_code=item.vehicle_code)
                db.add(vehicle)
                db.flush()
            _require_same_fleet(vehicle.fleet_id, fleet.id, f"vehicle {item.vehicle_code}")
            vehicle.make = item.make
            vehicle.model = item.model
            vehicle.category = item.category
            vehicle.variant = item.variant
            vehicle.usable_kwh = item.usable_kwh
            vehicle.battery_capacity_kwh = item.usable_kwh
            vehicle.kerb_weight = item.kerb_weight
            vehicle.regen_available = item.regen_available
            vehicle.certified_range = item.certified_range
            vehicle.max_range_km = item.certified_range
            vehicle.battery_chemistry = item.battery_chemistry
            vehicle.nominal_voltage = item.nominal_voltage
            vehicle.motor_kw = item.motor_kw
            vehicle.top_speed = item.top_speed
            vehicle.manufacture_year = item.manufacture_year
            vehicle.spec_incomplete = not is_prediction_spec_complete(vehicle)
            vehicle.is_active = True
            vehicles[item.vehicle_code] = vehicle

        for item in request.drivers:
            driver = db.query(Driver).filter(Driver.driver_code == item.driver_code).first()
            if driver is None:
                driver = Driver(
                    fleet_id=fleet.id,
                    driver_code=item.driver_code,
                    full_name=item.full_name,
                )
                db.add(driver)
                db.flush()
            _require_same_fleet(driver.fleet_id, fleet.id, f"driver {item.driver_code}")
            driver.full_name = item.full_name
            driver.phone = item.phone
            driver.style_label = item.style_label
            driver.assigned_vehicle_id = vehicles[item.assigned_vehicle_code].id

            user = db.query(User).filter(User.email == item.email).first()
            if user is None:
                user = User(
                    email=item.email,
                    full_name=item.full_name,
                    role="driver",
                    fleet_id=fleet.id,
                    driver_id=driver.id,
                    password_hash=None,
                )
                db.add(user)
            elif user.role != "driver":
                raise ValueError(f"user {item.email} already has role {user.role}")
            elif user.fleet_id and user.fleet_id != fleet.id:
                raise ValueError(f"user {item.email} already belongs to another fleet")
            user.full_name = item.full_name
            user.role = "driver"
            user.fleet_id = fleet.id
            user.driver_id = driver.id
            user.is_active = True

        for item in request.admins:
            user = db.query(User).filter(User.email == item.email).first()
            if user is None:
                user = User(
                    email=item.email,
                    full_name=item.full_name,
                    role="fleet_admin",
                    fleet_id=fleet.id,
                    password_hash=None,
                )
                db.add(user)
            elif user.role != "fleet_admin":
                raise ValueError(f"user {item.email} already has role {user.role}")
            elif user.fleet_id and user.fleet_id != fleet.id:
                raise ValueError(f"user {item.email} already belongs to another fleet")
            user.full_name = item.full_name
            user.role = "fleet_admin"
            user.fleet_id = fleet.id
            user.driver_id = None
            user.is_active = True

        db.commit()
        return {
            "fleet": request.fleet.name,
            "vehicle_codes": sorted(vehicles),
            "driver_codes": sorted(driver.driver_code for driver in request.drivers),
            "admin_emails": sorted(admin.email for admin in request.admins),
        }
    except Exception:
        db.rollback()
        raise
