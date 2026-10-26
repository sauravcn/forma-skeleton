"""Synthetic isolated HTTP, persistence, concurrency and migration acceptance."""

from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import os
from pathlib import Path
import queue
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from starter_api.repository import Problem, Repository
from starter_api.server import MAX_BODY, make_server


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "records.sqlite3"
        self.repository = Repository(self.database)
        self.repository.initialize()

    def tearDown(self):
        self.temp.cleanup()

    def test_empty_initialization_create_and_reopen_preserve_user_content(self):
        self.assertEqual(self.repository.records(), [])
        title = "Synthetic ' DROP TABLE records; — example"
        record = self.repository.create(
            {
                "title": title,
                "details": "<script>not executable</script>\nSynthetic text",
            }
        )
        self.assertEqual(record["status"], "todo")
        self.assertEqual(record["revision"], 1)
        self.assertTrue(record["created_at"].endswith("Z"))
        self.repository.initialize()
        fresh = Repository(self.database)
        fresh.initialize()
        self.assertEqual(fresh.records(), [record])
        self.assertEqual(fresh.records()[0]["title"], title)

    def test_validation_rejects_unknown_fields_types_and_invalid_transitions(self):
        for data in (
            {},
            {"title": " "},
            {"title": "x" * 201},
            {"title": False},
            {"title": "Valid", "details": "x" * 2001},
            {"title": "Valid", "role": "admin"},
        ):
            with self.subTest(data=str(data)[:100]):
                with self.assertRaises(Problem):
                    self.repository.create(data)
        self.assertEqual(self.repository.records(), [])
        row = self.repository.create({"title": "  Synthetic title  "})
        self.assertEqual(row["title"], "Synthetic title")
        for data in (
            {"status": "done"},
            {"status": "done", "expected_revision": True},
            {"status": "done", "expected_revision": 1, "extra": 1},
            {"status": "todo", "expected_revision": 1},
            {"status": "unknown", "expected_revision": 1},
        ):
            with self.subTest(data=data):
                with self.assertRaises(Problem):
                    self.repository.transition(row["id"], data)
        self.assertEqual(self.repository.records(), [row])

    def test_revision_gate_and_concurrent_writes_prevent_lost_updates(self):
        row = self.repository.create({"title": "Synthetic concurrent record"})

        def transition():
            try:
                return self.repository.transition(
                    row["id"], {"status": "done", "expected_revision": 1}
                )
            except Problem as error:
                return error

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: transition(), range(2)))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        failure = next(result for result in results if isinstance(result, Problem))
        self.assertEqual((failure.status, failure.code), (409, "records.error.stale"))
        saved = self.repository.records()[0]
        self.assertEqual((saved["status"], saved["revision"]), ("done", 2))
        reopened = self.repository.transition(
            row["id"], {"status": "todo", "expected_revision": 2}
        )
        self.assertEqual(reopened["revision"], 3)

    def test_missing_migration_source_fails_before_false_readiness(self):
        missing_database = Path(self.temp.name) / "missing.sqlite3"
        repository = Repository(
            missing_database, Path(self.temp.name) / "no-migrations"
        )
        with self.assertRaisesRegex(RuntimeError, "migration source is missing"):
            repository.initialize()
        self.assertFalse(missing_database.exists())

    def test_applied_migration_checksum_change_fails_without_reset(self):
        migrations = Path(self.temp.name) / "migrations"
        shutil.copytree(BACKEND / "starter_api/migrations", migrations)
        database = Path(self.temp.name) / "migrations.sqlite3"
        repository = Repository(database, migrations)
        repository.initialize()
        row = repository.create({"title": "Synthetic retained record"})
        source = migrations / "001_records.sql"
        source.write_text(
            source.read_text() + "\n-- Do not edit an applied migration.\n"
        )
        with self.assertRaisesRegex(RuntimeError, "checksum changed"):
            repository.initialize()
        self.assertEqual(repository.records(), [row])

    def test_missing_one_applied_migration_fails_before_any_new_migration(self):
        migrations = Path(self.temp.name) / "migrations"
        shutil.copytree(BACKEND / "starter_api/migrations", migrations)
        second = migrations / "002_index.sql"
        second.write_text("CREATE INDEX records_status ON records(status);\n")
        repository = Repository(
            Path(self.temp.name) / "missing-applied.sqlite3", migrations
        )
        repository.initialize()
        row = repository.create({"title": "Synthetic retained migration history"})
        with repository.connection() as connection:
            history = [
                dict(item)
                for item in connection.execute(
                    "SELECT * FROM schema_migrations ORDER BY name"
                )
            ]
        self.assertEqual(len(history), 2)
        second.unlink()
        (migrations / "003_new.sql").write_text(
            "CREATE TABLE must_not_apply(id INTEGER);\n"
        )
        with self.assertRaisesRegex(
            RuntimeError, "Applied migration source is missing"
        ):
            repository.initialize()
        self.assertEqual(repository.records(), [row])
        with repository.connection() as connection:
            self.assertEqual(
                [
                    dict(item)
                    for item in connection.execute(
                        "SELECT * FROM schema_migrations ORDER BY name"
                    )
                ],
                history,
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT name FROM sqlite_master WHERE name='must_not_apply'"
                ).fetchone()
            )

    def test_failed_additive_migration_rolls_back_ddl_and_marker(self):
        migrations = Path(self.temp.name) / "migrations"
        shutil.copytree(BACKEND / "starter_api/migrations", migrations)
        repository = Repository(Path(self.temp.name) / "rollback.sqlite3", migrations)
        repository.initialize()
        row = repository.create({"title": "Synthetic rollback evidence"})
        (migrations / "002_bad.sql").write_text(
            "CREATE TABLE should_not_survive(id INTEGER);\nINVALID SQL;\n"
        )
        with self.assertRaises(sqlite3.Error):
            repository.initialize()
        self.assertEqual(repository.records(), [row])
        with repository.connection() as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT name FROM sqlite_master WHERE name='should_not_survive'"
                ).fetchone()
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT name FROM schema_migrations WHERE name='002_bad.sql'"
                ).fetchone()
            )


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repository = Repository(Path(self.temp.name) / "http.sqlite3")
        self.repository.initialize()
        self.server = make_server(self.repository)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def request(self, method, path, data=None, headers=None, raw=None):
        body = (
            raw
            if raw is not None
            else json.dumps(data).encode()
            if data is not None
            else None
        )
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=3
        )
        try:
            connection.request(
                method,
                path,
                body=body,
                headers={"Content-Type": "application/json", **(headers or {})},
            )
            response = connection.getresponse()
            return (
                response.status,
                json.loads(response.read()),
                dict(response.getheaders()),
            )
        finally:
            connection.close()

    def test_health_and_complete_http_flow(self):
        status, data, headers = self.request("GET", "/api/health")
        self.assertEqual(
            (status, data),
            (
                200,
                {
                    "status": "ready",
                    "mode": "public-synthetic",
                    "authentication": "none",
                },
            ),
        )
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.request("GET", "/api/records")[1], {"records": []})
        status, row, _ = self.request(
            "POST",
            "/api/records",
            {"title": "Synthetic HTTP item", "details": "No customer data"},
        )
        self.assertEqual(status, 201)
        status, changed, _ = self.request(
            "PATCH",
            f"/api/records/{row['id']}",
            {"status": "done", "expected_revision": 1},
        )
        self.assertEqual((status, changed["revision"]), (200, 2))
        status, error, _ = self.request(
            "PATCH",
            f"/api/records/{row['id']}",
            {"status": "todo", "expected_revision": 1},
        )
        self.assertEqual((status, error["error_code"]), (409, "records.error.stale"))
        self.assertEqual(self.request("GET", "/api/records")[1]["records"], [changed])
        self.assertEqual(
            self.request(
                "PATCH", "/api/records/999", {"status": "done", "expected_revision": 1}
            )[0],
            404,
        )

    def test_foreign_origin_and_host_rejected_without_mutation(self):
        self.assertEqual(
            self.request(
                "POST",
                "/api/records",
                {"title": "Rejected"},
                {"Origin": "https://foreign.invalid"},
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "GET", "/api/records", headers={"Host": "127.0.0.1.foreign.invalid"}
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "GET", "/api/records", headers={"Host": "localhost@127.0.0.1"}
            )[0],
            403,
        )
        self.assertEqual(self.repository.records(), [])
        self.assertEqual(
            self.request(
                "POST",
                "/api/records",
                {"title": "Synthetic allowed origin"},
                {"Origin": "http://127.0.0.1:3000"},
            )[0],
            201,
        )

    def test_invalid_json_fields_content_type_and_body_size_fail(self):
        for raw in (
            b"[]",
            b'{"title":"a","title":"b"}',
            b'{"title":NaN}',
            b'{"title":"\\ud800"}',
            b"{broken",
            b"\xff",
        ):
            with self.subTest(raw=raw):
                self.assertEqual(self.request("POST", "/api/records", raw=raw)[0], 400)
        self.assertEqual(
            self.request("POST", "/api/records", {"title": "No", "admin": True})[0], 400
        )
        self.assertEqual(
            self.request(
                "POST", "/api/records", {"title": "No"}, {"Content-Type": "text/plain"}
            )[0],
            415,
        )
        self.assertEqual(
            self.request("POST", "/api/records", raw=b" " * (MAX_BODY + 1))[0], 413
        )
        self.assertEqual(self.repository.records(), [])

    def test_unknown_routes_methods_and_public_contract_do_not_claim_auth(self):
        for method, path in (
            ("GET", "/api/login"),
            ("POST", "/api/agent/commands"),
            ("GET", "/api/records/1"),
        ):
            self.assertEqual(self.request(method, path, {})[0], 404)
        self.assertEqual(self.request("DELETE", "/api/records", {})[0], 405)
        self.assertEqual(
            self.request(
                "PATCH",
                "/api/records/9223372036854775808",
                {"status": "done", "expected_revision": 1},
            )[0],
            404,
        )
        self.assertEqual(self.request("GET", "/api/records")[0], 200)


class EntryPointTests(unittest.TestCase):
    def test_source_entrypoint_respects_isolated_database_and_ephemeral_port(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "entry.sqlite3"
            process = subprocess.Popen(
                [sys.executable, str(BACKEND / "server.py")],
                env={**os.environ, "API_PORT": "0", "DATABASE_PATH": str(database)},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            line = queue.Queue()
            reader = threading.Thread(
                target=lambda: line.put(process.stdout.readline()), daemon=True
            )
            reader.start()
            try:
                message = line.get(timeout=5)
                port = int(re.search(r"port ([0-9]+)", message)[1])
                self.assertIn("authentication is not implemented", message)
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", "/api/health")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(
                    json.loads(response.read())["mode"], "public-synthetic"
                )
                connection.close()
                self.assertTrue(database.exists())
            finally:
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=5)
                reader.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
