import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.entities import Driver, Fleet, User, Vehicle
from app.services.provisioning import FleetProvisionRequest, provision_fleet


def _payload():
    return {
        "fleet": {"name": "Company Pilot", "city": "Surat"},
        "vehicles": [
            {
                "vehicle_code": "COMPANY-EV-1",
                "make": "Ather",
                "model": "450X",
                "category": "2W_passenger",
                "usable_kwh": 2.9,
                "kerb_weight": 108,
                "regen_available": True,
                "certified_range": 105,
            },
            {
                "vehicle_code": "COMPANY-EV-2",
                "make": "Ather",
                "model": "450X",
                "category": "2W_passenger",
                "usable_kwh": 2.9,
                "kerb_weight": 108,
                "regen_available": True,
                "certified_range": 105,
            },
        ],
        "drivers": [
            {
                "email": "ravi@company.example",
                "driver_code": "COMPANY-DRV-1",
                "full_name": "Ravi",
                "assigned_vehicle_code": "COMPANY-EV-1",
            },
            {
                "email": "priya@company.example",
                "driver_code": "COMPANY-DRV-2",
                "full_name": "Priya",
                "assigned_vehicle_code": "COMPANY-EV-2",
            },
        ],
        "admins": [{"email": "owner@company.example", "full_name": "Owner"}],
    }


def _ola_s1_payload(email="pilot@example.test"):
    return {
        "fleet": {"name": "Trickee GPS Pilot", "city": "Ahmedabad"},
        "vehicles": [{
            "vehicle_code": "OLA-S1-PILOT-01",
            "make": "OLA Electric",
            "model": "S1",
            "variant": "Standard S1",
            "manufacture_year": 2023,
            "category": "2W_passenger",
            "usable_kwh": 2.98,
            "battery_chemistry": "Lithium-ion",
            "motor_kw": 8.5,
            "kerb_weight": 121,
            "top_speed": 95,
            "regen_available": True,
            "certified_range": 141,
        }],
        "drivers": [{
            "email": email,
            "driver_code": "GPS-PILOT-01",
            "full_name": "Rhythm Pilot",
            "assigned_vehicle_code": "OLA-S1-PILOT-01",
        }],
    }


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'provision.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autocommit=False, autoflush=False)()
    yield session
    session.close()


def test_provisioning_is_idempotent_and_password_free(db):
    request = FleetProvisionRequest.model_validate(_payload())

    first = provision_fleet(db, request)
    second = provision_fleet(db, request)

    assert first == second
    assert db.query(Vehicle).count() == 2
    assert db.query(Driver).count() == 2
    assert db.query(User).count() == 3
    users = db.query(User).all()
    assert all(user.password_hash is None for user in users)
    assignments = {
        driver.driver_code: db.query(Vehicle).filter_by(id=driver.assigned_vehicle_id).one().vehicle_code
        for driver in db.query(Driver).all()
    }
    assert assignments == {
        "COMPANY-DRV-1": "COMPANY-EV-1",
        "COMPANY-DRV-2": "COMPANY-EV-2",
    }


def test_provisioning_rejects_duplicate_assignment_and_unknown_vehicle():
    duplicate = _payload()
    duplicate["drivers"][1]["assigned_vehicle_code"] = "COMPANY-EV-1"
    with pytest.raises(ValidationError, match="assigned once"):
        FleetProvisionRequest.model_validate(duplicate)

    unknown = _payload()
    unknown["drivers"][0]["assigned_vehicle_code"] = "MISSING"
    with pytest.raises(ValidationError, match="not declared"):
        FleetProvisionRequest.model_validate(unknown)


def test_standard_ola_s1_profile_is_prediction_complete_without_unknown_voltage(db):
    provision_fleet(db, FleetProvisionRequest.model_validate(_ola_s1_payload()))

    vehicle = db.query(Vehicle).filter_by(vehicle_code="OLA-S1-PILOT-01").one()
    driver = db.query(Driver).filter_by(driver_code="GPS-PILOT-01").one()
    user = db.query(User).filter_by(email="pilot@example.test").one()
    assert vehicle.usable_kwh == 2.98
    assert vehicle.kerb_weight == 121
    assert vehicle.motor_kw == 8.5
    assert vehicle.top_speed == 95
    assert vehicle.certified_range == 141
    assert vehicle.manufacture_year == 2023
    assert vehicle.nominal_voltage is None
    assert vehicle.spec_incomplete is False
    assert user.role == "driver"
    assert driver.assigned_vehicle_id == vehicle.id


def test_provisioning_will_not_silently_change_an_existing_user_role(db):
    db.add(User(email="pilot@example.test", full_name="Existing Admin", role="fleet_admin"))
    db.commit()

    with pytest.raises(ValueError, match="role fleet_admin"):
        provision_fleet(db, FleetProvisionRequest.model_validate(_ola_s1_payload()))


def test_cli_provision_role_loads_private_json_from_environment(tmp_path):
    database_path = tmp_path / "cli-provision.db"
    engine = create_engine(f"sqlite:///{database_path}")
    Base.metadata.create_all(engine)
    environment = os.environ.copy()
    environment["TRICKEE_DATABASE_URL"] = f"sqlite:///{database_path}"
    environment["TRICKEE_PROVISIONING_JSON"] = json.dumps(_payload())

    completed = subprocess.run(
        [sys.executable, "-m", "app.cli", "provision"],
        cwd=os.fspath(Path(__file__).parents[1]),
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "admin_emails": ["owner@company.example"],
        "driver_codes": ["COMPANY-DRV-1", "COMPANY-DRV-2"],
        "fleet": "Company Pilot",
        "vehicle_codes": ["COMPANY-EV-1", "COMPANY-EV-2"],
    }
    with sessionmaker(bind=engine)() as session:
        assert session.query(Fleet).filter_by(name="Company Pilot").count() == 1
        assert session.query(User).count() == 3
