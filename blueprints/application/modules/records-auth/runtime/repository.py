"""Owned-store migration and server-scoped records; never adopt existing public rows."""

from contextlib import contextmanager
import hashlib
from pathlib import Path
import sqlite3
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from starter_api.repository import Problem, exact_fields, bounded_text, timestamp

PROFILE = "password-totp-v1"
FIELDS = ("id", "title", "details", "status", "revision", "created_at", "updated_at")


def serialize(row):
    return {key: row[key] for key in FIELDS}


class Repository:
    def __init__(self, database, app_id, organization_id, migrations=None):
        if not app_id or not organization_id:
            raise RuntimeError("Explicit application and organization required")
        self.database = Path(database)
        self.app_id, self.organization_id = app_id, organization_id
        self.migrations = Path(migrations or Path(__file__).parent / "migrations")

    def migration_sources(self):
        base = sorted((self.migrations / "base").glob("*.sql"))
        additions = sorted(self.migrations.glob("*.sql"))
        paths = base + additions
        names = [p.name for p in paths]
        if (
            [p.name for p in base] != ["001_records.sql"]
            or "002_ownership.sql" not in names
            or len(names) != len(set(names))
            or any(
                not re.fullmatch(r"[0-9]{3}_[a-z0-9_]+\.sql", name) for name in names
            )
            or names != sorted(names)
        ):
            raise RuntimeError("Required ordered versioned migration source is missing")
        return paths

    def check(self, connection):
        marker = connection.execute(
            "SELECT app_id,organization_id,security_profile FROM forma_store_manifest WHERE singleton=1"
        ).fetchone()
        if marker is None or tuple(marker) != (
            self.app_id,
            self.organization_id,
            PROFILE,
        ):
            raise RuntimeError("Incompatible domain store scope/security profile")
        applied = {
            r["name"]: r["checksum"]
            for r in connection.execute("SELECT name,checksum FROM schema_migrations")
        }
        expected = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in self.migration_sources()
        }
        if applied != expected:
            raise RuntimeError(
                "Migration source/history differs; explicit review required"
            )

    @contextmanager
    def connect(self, write=False, migrate=False):
        if not migrate and not self.database.is_file():
            raise RuntimeError("Explicit domain migration required before startup")
        connection = sqlite3.connect(self.database, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            if not migrate:
                self.check(connection)
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def migrate(self):
        sources = self.migration_sources()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self.connect(write=True, migrate=True) as connection:
            tables = {
                r[0]
                for r in connection.execute(
                    "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
                )
            }
            marker_type = connection.execute(
                "SELECT type FROM sqlite_master WHERE name='forma_store_manifest'"
            ).fetchone()
            if marker_type and marker_type[0] != "table":
                raise RuntimeError("Domain ownership marker must be a table")
            if "forma_store_manifest" not in tables:
                if tables:
                    raise RuntimeError("Refusing unmarked populated domain store")
                connection.execute(
                    "CREATE TABLE forma_store_manifest(singleton INTEGER PRIMARY KEY CHECK(singleton=1),app_id TEXT NOT NULL,organization_id TEXT NOT NULL,security_profile TEXT NOT NULL)"
                )
                connection.execute(
                    "INSERT INTO forma_store_manifest VALUES(1,?,?,?)",
                    (self.app_id, self.organization_id, PROFILE),
                )
                connection.execute(
                    "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)"
                )
            marker = connection.execute(
                "SELECT app_id,organization_id,security_profile FROM forma_store_manifest WHERE singleton=1"
            ).fetchone()
            if marker is None or tuple(marker) != (
                self.app_id,
                self.organization_id,
                PROFILE,
            ):
                raise RuntimeError("Incompatible domain store scope/security profile")
            applied = {
                r["name"]: r["checksum"]
                for r in connection.execute(
                    "SELECT name,checksum FROM schema_migrations"
                )
            }
            if set(applied) - {p.name for p in sources}:
                raise RuntimeError("Applied migration source is missing")
            for source in sources:
                checksum = hashlib.sha256(source.read_bytes()).hexdigest()
                if source.name in applied:
                    if applied[source.name] != checksum:
                        raise RuntimeError("Applied migration checksum changed")
                    continue
                statement = ""
                for line in source.read_text().splitlines(keepends=True):
                    statement += line
                    if sqlite3.complete_statement(statement):
                        connection.execute(statement)
                        statement = ""
                if statement.strip():
                    raise RuntimeError("Incomplete migration SQL")
                connection.execute(
                    "INSERT INTO schema_migrations VALUES(?,?)", (source.name, checksum)
                )
            self.check(connection)

    def ready(self):
        with self.connect() as connection:
            connection.execute(
                "SELECT id,organization_id,owner_user_id FROM records LIMIT 0"
            )
        return {
            "status": "ready",
            "mode": "authenticated",
            "authentication": "password-totp-v1",
        }

    def scope(self, principal, permission):
        if (
            principal["app_id"] != self.app_id
            or principal["organization_id"] != self.organization_id
            or permission not in principal["permissions"]
        ):
            raise Problem("identity.error.forbidden", 403)
        return principal["organization_id"], principal["user_id"]

    def records(self, principal):
        org, user = self.scope(principal, "records:read")
        with self.connect() as connection:
            query = "SELECT * FROM records WHERE organization_id=?"
            args = [org]
            if "records:read:any" not in principal["permissions"]:
                query += " AND owner_user_id=?"
                args.append(user)
            return [
                serialize(r)
                for r in connection.execute(query + " ORDER BY id DESC", args)
            ]

    def create(self, principal, data):
        org, user = self.scope(principal, "records:write")
        exact_fields(data, ("title", "details"), ("title",))
        title = bounded_text(data["title"], 200, required=True)
        details = bounded_text(data.get("details", ""), 2000)
        now = timestamp()
        with self.connect(write=True) as connection:
            ident = connection.execute(
                "INSERT INTO records(title,details,created_at,updated_at,organization_id,owner_user_id) VALUES(?,?,?,?,?,?)",
                (title, details, now, now, org, user),
            ).lastrowid
            return serialize(
                connection.execute(
                    "SELECT * FROM records WHERE id=?", (ident,)
                ).fetchone()
            )

    def transition(self, principal, ident, data):
        org, user = self.scope(principal, "records:write")
        exact_fields(
            data, ("status", "expected_revision"), ("status", "expected_revision")
        )
        status, revision = data["status"], data["expected_revision"]
        if status not in ("todo", "done") or type(revision) is not int or revision < 1:
            raise Problem("records.error.invalid")
        with self.connect(write=True) as connection:
            previous = connection.execute(
                "SELECT * FROM records WHERE id=? AND organization_id=?", (ident, org)
            ).fetchone()
            if previous is None or (
                previous["owner_user_id"] != user
                and "records:write:any" not in principal["permissions"]
            ):
                raise Problem("records.error.notFound", 404)
            if previous["revision"] != revision:
                raise Problem("records.error.stale", 409)
            if previous["status"] == status:
                raise Problem("records.error.invalid", 409)
            connection.execute(
                "UPDATE records SET status=?,revision=revision+1,updated_at=? WHERE id=?",
                (status, timestamp(), ident),
            )
            return serialize(
                connection.execute(
                    "SELECT * FROM records WHERE id=?", (ident,)
                ).fetchone()
            )
