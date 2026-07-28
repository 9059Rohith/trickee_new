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

        demo_accounts = (
            ("driver1@evify.in", "DRV-001", "Ravi Kumar", "Moderate"),
            ("driver2@evify.in", "DRV-002", "Priya Sharma", "Efficient"),
        )
        for email, driver_code, full_name, style_label in demo_accounts:
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

        vehicle = Vehicle(
            fleet_id=fleet.id,
            vehicle_code="EV-001",
            make="Ather",
            model="450X",
            category="2W_passenger",
            variant="Standard",
            usable_kwh=2.9,
            rated_ah=56.0,
            battery_chemistry="NMC",
            nominal_voltage=51.8,
            motor_kw=6.0,
            kerb_weight=108.0,
            gvw=250.0,
            payload_capacity=100.0,
            top_speed=80.0,
            regen_available=True,
            certified_range=105.0,
            max_range_km=105.0,
            battery_capacity_kwh=2.9,
            spec_incomplete=False,
        )
        existing_vehicle = db.query(Vehicle).filter(Vehicle.vehicle_code == "EV-001").first()
        if not existing_vehicle:
            db.add(vehicle)
        db.commit()
        print("Demo drivers: driver1@evify.in and driver2@evify.in / Driver@2026")
        print("Demo manager: owner@evify.in / Manager@2026")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
