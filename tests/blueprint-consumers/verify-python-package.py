#!/usr/bin/env python3
"""Build and verify the included API wheel outside either seller checkout.

Uses only temporary source copies, a fresh venv and synthetic SQLite records.
Normal third-party build tooling may be downloaded by pip; runtime installation
uses --no-index, and the verification interpreter uses isolated (-I) imports.
"""

from pathlib import Path, PurePosixPath
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile


REPOSITORY = Path(__file__).resolve().parents[2]
BACKEND = REPOSITORY / "blueprints/application/backend"


def clean_environment():
    environment = dict(os.environ)
    for name in ("PYTHONPATH", "PYTHONHOME", "NODE_PATH", "VIRTUAL_ENV"):
        environment.pop(name, None)
    environment["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    environment["PYTHONUTF8"] = "1"
    return environment


def run(command, *, cwd, environment, label, timeout=180):
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f"{label} could not complete: {type(error).__name__}") from error
    if result.returncode:
        # Do not disclose credentials embedded in an installer/index/proxy URL.
        diagnostic = re.sub(r"https?://\S+", "<URL omitted>", result.stdout[-5000:])
        raise RuntimeError(f"{label} failed ({result.returncode}):\n{diagnostic}")
    return result.stdout


# Executed by a clean venv with -I, not imported from the authoring source tree.
VERIFY = r'''
from pathlib import Path
import http.client
import json
import os
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import re
import starter_api
from starter_api.repository import Repository

package = Path(starter_api.__file__).resolve()
site = Path(sys.prefix).resolve()
assert package.is_relative_to(site), "API import escaped the isolated venv"
assert "site-packages" in package.parts, "API was not imported from installed distribution"
assert (package.parent / "migrations/001_records.sql").is_file(), "Packaged SQL missing"
console = Path(sys.argv[1])

with tempfile.TemporaryDirectory(prefix="forma-wheel-runtime-") as temporary:
    database = Path(temporary) / "synthetic.sqlite3"
    repository = Repository(database)
    repository.initialize()
    initial = repository.create({"title": "Synthetic installed-package seed"})
    repository.initialize()
    assert repository.records() == [initial], "Repeat initialization changed data"

    def request(port, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            body = json.dumps(payload).encode() if payload is not None else None
            connection.request(method, path, body=body, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def exercise_console(expected=None):
        # Runtime gets local process essentials only, never provider/seller secrets.
        allowed = ("PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT")
        environment = {key: os.environ[key] for key in allowed if key in os.environ}
        environment.update(API_PORT="0", DATABASE_PATH=str(database), PYTHONUTF8="1")
        process = subprocess.Popen(
            [str(console)], env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        lines = queue.Queue()
        reader = threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True)
        reader.start()
        port = None
        try:
            line = lines.get(timeout=8)
            match = re.search(r"port ([0-9]+)", line)
            assert match, "Installed console did not announce a bound loopback port"
            port = int(match[1])
            status, health = request(port, "GET", "/api/health")
            assert status == 200 and health == {
                "status": "ready", "mode": "public-synthetic", "authentication": "none"
            }, "Installed health contract differs"
            if expected is None:
                status, created = request(port, "POST", "/api/records", {
                    "title": "Synthetic installed-console record", "details": "No customer data"
                })
                assert status == 201 and created["revision"] == 1
                status, expected = request(port, "PATCH", "/api/records/" + str(created["id"]), {
                    "status": "done", "expected_revision": 1
                })
                assert status == 200 and expected["revision"] == 2
                assert request(port, "PATCH", "/api/records/" + str(created["id"]), {
                    "status": "todo", "expected_revision": 1
                })[0] == 409
            status, response = request(port, "GET", "/api/records")
            assert status == 200 and initial in response["records"] and expected in response["records"], "Installed data/restart persistence failed"
            return expected
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise AssertionError("Installed console did not terminate cleanly")
            reader.join(timeout=2)
            process.stdout.close()
            process.stderr.close()
            if port is not None:
                with socket.socket() as probe:
                    probe.settimeout(1)
                    assert probe.connect_ex(("127.0.0.1", port)) != 0, "Installed console left its port open"

    saved = exercise_console()
    exercise_console(saved)
print(json.dumps({"isolated_installed_import": True, "packaged_sql": True, "repeatable_migration": True, "installed_console_http": True, "revision_gate": True, "restart_persistence": True, "port_cleanup": True}))
'''


def main():
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11+ is required for this consumer proof")
    if not (BACKEND / "pyproject.toml").is_file():
        raise RuntimeError("Included backend package source is missing")
    environment = clean_environment()
    with tempfile.TemporaryDirectory(prefix="forma-python-package-proof-") as directory:
        root = Path(directory)
        source = root / "source"
        shutil.copytree(
            BACKEND,
            source,
            symlinks=True,
            ignore=shutil.ignore_patterns(
                "__pycache__", "*.pyc", ".venv", "data", "build", "dist",
                "*.egg-info", ".env*", "*.db", "*.sqlite", "*.sqlite3",
            ),
        )
        if any(path.is_symlink() for path in source.rglob("*")):
            raise RuntimeError("Package source must not depend on symlinked external files")
        environment["PIP_CACHE_DIR"] = str(root / "pip-cache")
        wheels = root / "wheels"
        wheels.mkdir()
        run(
            [sys.executable, "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheels), str(source)],
            cwd=root, environment=environment, label="Temporary-copy wheel build",
        )
        artifacts = list(wheels.glob("starter_records_api-*.whl"))
        if len(artifacts) != 1:
            raise RuntimeError("Expected exactly one starter API wheel")
        wheel = artifacts[0]
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            if "starter_api/migrations/001_records.sql" not in names:
                raise RuntimeError("Wheel is missing required migration SQL")
            for name in names:
                parts = PurePosixPath(name)
                if parts.is_absolute() or ".." in parts.parts or "tests" in parts.parts or name.endswith((".db", ".sqlite", ".sqlite3", ".pyc")) or ".env" in parts.name:
                    raise RuntimeError("Wheel contains an excluded/unsafe artifact")
        consumer = root / "consumer"
        run(
            [sys.executable, "-m", "venv", str(consumer)],
            cwd=root, environment=environment, label="Fresh consumer venv",
        )
        binary = consumer / ("Scripts" if os.name == "nt" else "bin")
        python = binary / ("python.exe" if os.name == "nt" else "python")
        console = binary / ("starter-records-api.exe" if os.name == "nt" else "starter-records-api")
        run(
            [str(python), "-m", "pip", "install", "--no-index", "--find-links", str(wheels), str(wheel)],
            cwd=root, environment=environment, label="Offline wheel installation",
        )
        report = run(
            [str(python), "-I", "-c", VERIFY, str(console)],
            cwd=root, environment=environment, label="Isolated installed console/API verification", timeout=40,
        )
        checks = json.loads(report)
        print(json.dumps({"wheel": wheel.name, "temporary_source_copy": True, "offline_install": True, "checks": checks}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError) as error:
        print(f"Python package consumer proof failed: {error}", file=sys.stderr)
        raise SystemExit(1)
