"""Transactional SQLite mechanics and a deliberately small synthetic domain."""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sqlite3


class Problem(ValueError):
    def __init__(self, code, status=400):
        self.code = code
        self.status = status
        super().__init__(code)


def timestamp():
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def exact_fields(data, allowed, required):
    if (
        not isinstance(data, dict)
        or set(data) - set(allowed)
        or set(required) - set(data)
    ):
        raise Problem("records.error.invalid")


def bounded_text(value, maximum, *, required=False):
    if not isinstance(value, str):
        raise Problem("records.error.invalid")
    result = value.strip() if required else value
    try:
        result.encode("utf-8")
    except UnicodeError:
        raise Problem("records.error.invalid")
    if "\0" in result:
        raise Problem("records.error.invalid")
    if len(result) > maximum or (required and not result):
        raise Problem("records.error.invalid")
    return result


class Repository:
    def __init__(self, database, migrations=None):
        self.database = Path(database)
        self.migrations = Path(migrations or Path(__file__).parent / "migrations")

    @contextmanager
    def connection(self, write=False):
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        migrations = sorted(self.migrations.glob("*.sql"))
        if not migrations:
            raise RuntimeError("Required migration source is missing")
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self.connection(write=True) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(name TEXT PRIMARY KEY, checksum TEXT NOT NULL)"
            )
            applied_names = {
                row["name"]
                for row in connection.execute("SELECT name FROM schema_migrations")
            }
            if applied_names - {migration.name for migration in migrations}:
                raise RuntimeError("Applied migration source is missing")
            for migration in migrations:
                source = migration.read_text(encoding="utf-8")
                checksum = hashlib.sha256(migration.read_bytes()).hexdigest()
                previous = connection.execute(
                    "SELECT checksum FROM schema_migrations WHERE name=?",
                    (migration.name,),
                ).fetchone()
                if previous:
                    if previous["checksum"] != checksum:
                        raise RuntimeError("Applied migration checksum changed")
                    continue
                statement = ""
                for line in source.splitlines(keepends=True):
                    statement += line
                    if sqlite3.complete_statement(statement):
                        connection.execute(statement)
                        statement = ""
                if statement.strip():
                    raise RuntimeError("Migration has an incomplete SQL statement")
                connection.execute(
                    "INSERT INTO schema_migrations(name,checksum) VALUES (?,?)",
                    (migration.name, checksum),
                )
            connection.execute("SELECT id FROM records LIMIT 0")

    def ready(self):
        with self.connection() as connection:
            connection.execute("SELECT id FROM records LIMIT 0")
        return {"status": "ready", "mode": "public-synthetic", "authentication": "none"}

    def records(self):
        with self.connection() as connection:
            return [
                dict(row)
                for row in connection.execute("SELECT * FROM records ORDER BY id DESC")
            ]

    def create(self, data):
        exact_fields(data, ("title", "details"), ("title",))
        title = bounded_text(data["title"], 200, required=True)
        details = bounded_text(data.get("details", ""), 2000)
        now = timestamp()
        with self.connection(write=True) as connection:
            ident = connection.execute(
                "INSERT INTO records(title,details,created_at,updated_at) VALUES (?,?,?,?)",
                (title, details, now, now),
            ).lastrowid
            return dict(
                connection.execute(
                    "SELECT * FROM records WHERE id=?", (ident,)
                ).fetchone()
            )

    def transition(self, ident, data):
        exact_fields(
            data, ("status", "expected_revision"), ("status", "expected_revision")
        )
        status = data["status"]
        revision = data["expected_revision"]
        if status not in ("todo", "done") or type(revision) is not int or revision < 1:
            raise Problem("records.error.invalid")
        with self.connection(write=True) as connection:
            previous = connection.execute(
                "SELECT * FROM records WHERE id=?", (ident,)
            ).fetchone()
            if previous is None:
                raise Problem("records.error.notFound", 404)
            if previous["revision"] != revision:
                raise Problem("records.error.stale", 409)
            if previous["status"] == status:
                raise Problem("records.error.invalid", 409)
            connection.execute(
                "UPDATE records SET status=?,revision=revision+1,updated_at=? WHERE id=?",
                (status, timestamp(), ident),
            )
            return dict(
                connection.execute(
                    "SELECT * FROM records WHERE id=?", (ident,)
                ).fetchone()
            )
