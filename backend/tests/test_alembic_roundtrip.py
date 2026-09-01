import os
import subprocess
import sys


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
