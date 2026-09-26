import os
import subprocess
import sys

from sqlalchemy import create_engine, inspect, text


def test_alembic_upgrade_downgrade_roundtrip_uses_an_isolated_database(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'alembic-roundtrip.db'}"
    environment = {**os.environ, "TRICKEE_DATABASE_URL": database_url}
    backend_root = __file__.rsplit("tests", 1)[0]
    for command in (("upgrade", "head"), ("downgrade", "base"), ("upgrade", "head")):
        completed = subprocess.run(
            [sys.executable, "-m", "alembic", *command],
            cwd=backend_root,
            env=environment,
            capture_output=True,
            text=True,
        )
        assert completed.returncode == 0, completed.stderr
        tables = inspect(create_engine(database_url)).get_table_names()
        assert ("live_nudge_evaluations" in tables) == (command[0] == "upgrade")
        assert ("daily_plan_legs" in tables) == (command[0] == "upgrade")
        if command[0] == "upgrade":
            columns = {column["name"] for column in inspect(create_engine(database_url)).get_columns("mobile_trip_sessions")}
            assert {"planned_trip_id", "planned_leg_index", "destination_source", "ended_lat", "ended_lng"} <= columns


def test_0008_upgrade_preserves_existing_daily_plan_result_payload(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'preserve-result.db'}"
    environment = {**os.environ, "TRICKEE_DATABASE_URL": database_url}
    backend_root = __file__.rsplit("tests", 1)[0]
    engine = create_engine(database_url)

    before = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0007_fcm_device_tokens"],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
    )
    assert before.returncode == 0, before.stderr
    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.execute(text("""
            INSERT INTO daily_plans (
                id, user_id, driver_id, vehicle_id, service_date, timezone,
                starting_soc_pct, source_message, parser_source, draft_payload,
                result_payload, status, created_at, updated_at
            ) VALUES (
                'plan-1', 'user-1', 'driver-1', 'vehicle-1', '2026-09-26', 'Asia/Kolkata',
                80, 'Office at 9', 'rules', '{}', :result_payload,
                'confirmed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
        """), {"result_payload": '{"legs":[{"index":0}]}'})

    after = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
    )
    assert after.returncode == 0, after.stderr
    with engine.connect() as connection:
        value = connection.execute(
            text("SELECT result_payload FROM daily_plans WHERE id='plan-1'")
        ).scalar_one()
    assert '"legs"' in value
