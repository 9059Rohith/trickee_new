"""Seed demo fleet/driver/vehicle for local GPS-first development."""
from __future__ import annotations

from app.database import SessionLocal, create_tables
from app.models.entities import Driver, Fleet, User, Vehicle
from app.services.auth import hash_password


def seed() -> None:
    create_tables()
    db = SessionLocal()
    try:
        fleet = db.query(Fleet).filter(Fleet.name == "EVIFY Pilot").first()
        if not fleet:
            fleet = Fleet(name="EVIFY Pilot", city="Surat")
            db.add(fleet)
            db.flush()

        vehicle_specs = (
            ("EV-001", "Ather", "450X"),
            ("EV-002", "Ather", "450X"),
        )
        vehicles: dict[str, Vehicle] = {}
        for vehicle_code, make, model in vehicle_specs:
            vehicle = db.query(Vehicle).filter(Vehicle.vehicle_code == vehicle_code).first()
            if not vehicle:
                vehicle = Vehicle(fleet_id=fleet.id, vehicle_code=vehicle_code)
                db.add(vehicle)
                db.flush()
            vehicle.fleet_id = fleet.id
            vehicle.make = make
            vehicle.model = model
            vehicle.category = "2W_passenger"
            vehicle.variant = "Standard"
            vehicle.usable_kwh = 2.9
            vehicle.rated_ah = 56.0
            vehicle.battery_chemistry = "NMC"
            vehicle.nominal_voltage = 51.8
            vehicle.motor_kw = 6.0
            vehicle.kerb_weight = 108.0
            vehicle.gvw = 250.0
            vehicle.payload_capacity = 100.0
            vehicle.top_speed = 80.0
            vehicle.regen_available = True
            vehicle.certified_range = 105.0
            vehicle.max_range_km = 105.0
            vehicle.battery_capacity_kwh = 2.9
            vehicle.spec_incomplete = False
            vehicle.is_active = True
            vehicles[vehicle_code] = vehicle

        demo_accounts = (
            ("driver1@evify.in", "DRV-001", "Ravi Kumar", "Moderate", "EV-001"),
            ("driver2@evify.in", "DRV-002", "Priya Sharma", "Efficient", "EV-002"),
        )
        for email, driver_code, full_name, style_label, vehicle_code in demo_accounts:
            driver = db.query(Driver).filter(Driver.driver_code == driver_code).first()
            if not driver:
                driver = Driver(
                    fleet_id=fleet.id,
                    driver_code=driver_code,
                    full_name=full_name,
                    style_label=style_label,
                )
                db.add(driver)
                db.flush()
            driver.fleet_id = fleet.id
            driver.full_name = full_name
            driver.style_label = style_label
            driver.assigned_vehicle_id = vehicles[vehicle_code].id

            user = db.query(User).filter(User.email == email).first()
            if not user:
                user = User(
                    email=email,
                    full_name=full_name,
                    role="driver",
                    fleet_id=fleet.id,
                    driver_id=driver.id,
                )
                db.add(user)
            user.password_hash = hash_password("Driver@2026")
            user.is_active = True

        owner = db.query(User).filter(User.email == "owner@evify.in").first()
        if not owner:
            owner = User(
                email="owner@evify.in",
                full_name="EVIFY Fleet Manager",
                role="fleet_admin",
                fleet_id=fleet.id,
            )
            db.add(owner)
        owner.password_hash = hash_password("Manager@2026")
        owner.is_active = True

        db.commit()
        print("Demo drivers: driver1@evify.in and driver2@evify.in / Driver@2026")
        print("Demo manager: owner@evify.in / Manager@2026")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
