"""Standalone copied-source domain guards; no credentials or existing DBs."""

import importlib.util
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest
import json
import threading
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer


class DomainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="forma-domain-tests-")
        cls.root = Path(cls.workspace.name)
        runtime = Path(__file__).resolve().parents[1]
        base = runtime.parent / "backend"
        if not base.is_dir():
            base = runtime.parents[2] / "backend"
        shutil.copytree(
            base,
            cls.root / "backend",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "data"),
        )
        shutil.copytree(
            runtime,
            cls.root / "backend-auth",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "tests"),
        )
        migrations = cls.root / "backend-auth/migrations/base"
        if not migrations.exists():
            shutil.copytree(base / "starter_api/migrations", migrations)
        spec = importlib.util.spec_from_file_location(
            "owned_domain_repository", cls.root / "backend-auth/repository.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        identity_source = runtime.parent / "identity/core/boundary/python"
        if not identity_source.is_dir():
            identity_source = runtime.parents[4] / "packages/identity-boundary/python"
        identity_target = cls.root / "identity/core/boundary/python"
        shutil.copytree(
            identity_source,
            identity_target,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        sys.modules["repository"] = cls.module
        server_spec = importlib.util.spec_from_file_location(
            "owned_domain_server", cls.root / "backend-auth/server.py"
        )
        cls.server_module = importlib.util.module_from_spec(server_spec)
        server_spec.loader.exec_module(cls.server_module)

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="forma-domain-db-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "records.sqlite3"
        self.repo = self.module.Repository(
            self.path, "test-app", "org-a", self.root / "backend-auth/migrations"
        )
        self.principal = {
            "app_id": "test-app",
            "organization_id": "org-a",
            "user_id": "user-a",
            "permissions": ["records:read", "records:write"],
        }

    def test_explicit_migration_scope_and_no_runtime_creation(self):
        with self.assertRaises(RuntimeError):
            self.repo.ready()
        self.assertFalse(self.path.exists())
        self.repo.migrate()
        self.repo.migrate()
        self.repo.ready()
        with self.assertRaises(RuntimeError):
            self.module.Repository(
                self.path, "other-app", "org-a", self.repo.migrations
            ).ready()

    def test_foreign_unmarked_store_is_never_adopted(self):
        for sql in (
            "CREATE TABLE foreign_data(value TEXT)",
            "CREATE VIEW foreign_view AS SELECT 1",
        ):
            with sqlite3.connect(self.path) as c:
                c.execute(sql)
            with self.assertRaises(RuntimeError):
                self.repo.migrate()
            with sqlite3.connect(self.path) as c:
                self.assertFalse(
                    c.execute(
                        "SELECT 1 FROM sqlite_master WHERE name='forma_store_manifest'"
                    ).fetchone()
                )
            self.path.unlink()

    def test_owner_role_scope_and_revision(self):
        self.repo.migrate()
        record = self.repo.create(self.principal, {"title": "Synthetic"})
        self.assertEqual(record["revision"], 1)
        self.assertNotIn("owner_user_id", record)
        other = {**self.principal, "user_id": "user-b"}
        self.assertEqual(self.repo.records(other), [])
        with self.assertRaises(self.module.Problem) as error:
            self.repo.transition(
                other, record["id"], {"status": "done", "expected_revision": 1}
            )
        self.assertEqual(error.exception.status, 404)
        for data in (
            {"title": "Synthetic", "owner_user_id": "user-b"},
            {"title": "Synthetic", "organization_id": "org-b"},
        ):
            with self.assertRaises(self.module.Problem):
                self.repo.create(self.principal, data)
        changed = self.repo.transition(
            self.principal, record["id"], {"status": "done", "expected_revision": 1}
        )
        self.assertEqual(changed["revision"], 2)
        with self.assertRaises(self.module.Problem) as error:
            self.repo.transition(
                self.principal, record["id"], {"status": "todo", "expected_revision": 1}
            )
        self.assertEqual(error.exception.status, 409)
        with self.assertRaises(self.module.Problem):
            self.repo.records({**self.principal, "organization_id": "org-b"})
        with self.assertRaises(self.module.Problem):
            self.repo.create(
                {**self.principal, "permissions": ["records:read"]}, {"title": "No"}
            )
        admin = {
            **other,
            "permissions": [
                "records:read",
                "records:write",
                "records:read:any",
                "records:write:any",
            ],
        }
        self.assertEqual(len(self.repo.records(admin)), 1)

    def test_actual_http_parser_origin_and_current_principal_guards(self):
        self.repo.migrate()
        principal = self.principal
        denied = self.server_module.Denied

        class Identity:
            def authorize(inner, cookie):
                if cookie != "synthetic=valid":
                    raise denied(401, "identity.error.required")
                return principal

        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            self.server_module.make_handler(
                self.repo, Identity(), "http://127.0.0.1:3000"
            ),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(
            lambda: (server.shutdown(), server.server_close(), thread.join(2))
        )
        origin = f"http://127.0.0.1:{server.server_port}"

        def request(
            method,
            path="/api/records",
            data=None,
            cookie="synthetic=valid",
            write_origin="http://127.0.0.1:3000",
        ):
            headers = {"Content-Type": "application/json"}
            if cookie:
                headers["Cookie"] = cookie
            if write_origin:
                headers["Origin"] = write_origin
            req = Request(
                origin + path,
                data=json.dumps(data).encode() if data is not None else None,
                headers=headers,
                method=method,
            )
            try:
                with urlopen(req, timeout=3) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.load(error)

        self.assertEqual(request("GET", cookie=None)[0], 401)
        self.assertEqual(request("GET", cookie="synthetic=forged")[0], 401)
        self.assertEqual(
            request("POST", data={"title": "Synthetic"}, write_origin=None)[0], 403
        )
        self.assertEqual(
            request(
                "POST", data={"title": "Synthetic"}, write_origin="http://foreign.test"
            )[0],
            403,
        )
        self.assertEqual(
            request("POST", data={"title": "Synthetic", "owner_user_id": "forged"})[0],
            400,
        )
        status, record = request("POST", data={"title": "Synthetic"})
        self.assertEqual(status, 201)
        principal = {**self.principal, "user_id": "user-b"}
        self.assertEqual(request("GET")[1], {"records": []})
        self.assertEqual(
            request(
                "PATCH",
                f"/api/records/{record['id']}",
                {"status": "done", "expected_revision": 1},
            )[0],
            404,
        )
        principal = self.principal
        self.assertEqual(
            request(
                "PATCH",
                f"/api/records/{record['id']}",
                {"status": "done", "expected_revision": 1},
            )[0],
            200,
        )
        self.assertEqual(
            request(
                "PATCH",
                f"/api/records/{record['id']}",
                {"status": "todo", "expected_revision": 1},
            )[0],
            409,
        )

    def test_reviewed_additive_migration_preserves_existing_records(self):
        migrations = Path(self.temp.name) / "migrations"
        shutil.copytree(self.repo.migrations, migrations)
        self.repo.migrations = migrations
        self.repo.migrate()
        record = self.repo.create(self.principal, {"title": "Retained additive record"})
        (migrations / "003_note.sql").write_text(
            "CREATE TABLE reviewed_extension(value TEXT);\n"
        )
        with self.assertRaises(RuntimeError):
            self.repo.ready()
        self.repo.migrate()
        self.assertEqual(self.repo.records(self.principal), [record])
        self.repo.ready()

    def test_migration_history_is_immutable_and_public_refuses_auth_store(self):
        self.repo.migrate()
        self.repo.create(self.principal, {"title": "Retain"})
        with sqlite3.connect(self.path) as c:
            c.execute(
                "UPDATE schema_migrations SET checksum='changed' WHERE name='001_records.sql'"
            )
        with self.assertRaises(RuntimeError):
            self.repo.ready()
        with self.assertRaises(RuntimeError):
            self.repo.migrate()
        from starter_api.repository import Repository

        with self.assertRaises(RuntimeError):
            Repository(self.path).initialize()
        with self.assertRaises(RuntimeError):
            Repository(self.path).records()


if __name__ == "__main__":
    unittest.main()
