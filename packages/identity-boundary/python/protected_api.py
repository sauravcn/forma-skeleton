"""Non-shipped synthetic session/ownership boundary fixture; no login/MFA flow."""

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit

from identity_client import Denied, IdentityClient


class Records:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, title TEXT NOT NULL, organization_id TEXT NOT NULL, owner_user_id TEXT NOT NULL)"
            )

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def list(self, principal):
        with self.connect() as connection:
            if "records:read:any" in principal["permissions"]:
                rows = connection.execute(
                    "SELECT * FROM records WHERE organization_id=? ORDER BY id",
                    (principal["organization_id"],),
                )
            else:
                rows = connection.execute(
                    "SELECT * FROM records WHERE organization_id=? AND owner_user_id=? ORDER BY id",
                    (principal["organization_id"], principal["user_id"]),
                )
            return [dict(row) for row in rows]

    def create(self, principal, data):
        if (
            not isinstance(data, dict)
            or set(data) != {"title"}
            or not isinstance(data["title"], str)
            or not 0 < len(data["title"].strip()) <= 200
        ):
            raise Denied(400, "records.error.invalid")
        with self.connect() as connection:
            ident = connection.execute(
                "INSERT INTO records(title,organization_id,owner_user_id) VALUES (?,?,?)",
                (
                    data["title"].strip(),
                    principal["organization_id"],
                    principal["user_id"],
                ),
            ).lastrowid
            return dict(
                connection.execute(
                    "SELECT * FROM records WHERE id=?", (ident,)
                ).fetchone()
            )


def handler(identity, records, public_origin):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            for key, item in {
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            }.items():
                self.send_header(key, item)
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self, method):
            try:
                self.connection.settimeout(5)
                if not re.fullmatch(
                    r"(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?",
                    self.headers.get("Host", ""),
                ):
                    raise Denied(403, "identity.error.origin")
                if method == "GET" and self.path == "/api/health":
                    return self.reply(
                        200,
                        {
                            "mode": "non-shipped-session-boundary-proof",
                            "assurance": "basic-session-fixture",
                            "mfa_implemented": False,
                        },
                    )
                if self.path != "/api/records":
                    raise Denied(404, "records.error.notFound")
                principal = identity.authorize(self.headers.get("Cookie", ""))
                if method == "GET":
                    if "records:read" not in principal["permissions"]:
                        raise Denied(403, "identity.error.forbidden")
                    return self.reply(200, {"records": records.list(principal)})
                if method == "POST":
                    if "records:write" not in principal["permissions"]:
                        raise Denied(403, "identity.error.forbidden")
                    if self.headers.get("Origin") != public_origin:
                        raise Denied(403, "identity.error.origin")
                    if (
                        self.headers.get("Content-Type", "").split(";")[0].lower()
                        != "application/json"
                        or self.headers.get("Transfer-Encoding") is not None
                    ):
                        raise Denied(415, "records.error.invalid")
                    length = self.headers.get_all("Content-Length", [])
                    if (
                        len(length) != 1
                        or not re.fullmatch(r"[0-9]{1,5}", length[0])
                        or not 0 < int(length[0]) <= 4096
                    ):
                        raise Denied(413, "records.error.invalid")
                    try:
                        data = json.loads(self.rfile.read(int(length[0])))
                    except (ValueError, UnicodeError, RecursionError):
                        raise Denied(400, "records.error.invalid")
                    return self.reply(201, records.create(principal, data))
                raise Denied(405, "records.error.invalid")
            except Denied as error:
                self.reply(error.status, {"error_code": error.code})
            except Exception:
                self.reply(503, {"error_code": "identity.error.unavailable"})

        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

    return Handler


def main():
    origin = os.environ["PROOF_PUBLIC_ORIGIN"]
    parsed = urlsplit(origin)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in ("127.0.0.1", "localhost")
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        raise SystemExit("Explicit loopback public origin is required")
    identity = IdentityClient(
        os.environ["PROOF_IDENTITY_URL"],
        os.environ["PROOF_APP_ID"],
        os.environ["PROOF_ORGANIZATION_ID"],
        os.environ["PROOF_SESSION_COOKIE_NAME"],
    )
    records = Records(os.environ["PROOF_DATABASE_PATH"])
    server = ThreadingHTTPServer(
        ("127.0.0.1", int(os.environ.get("PROOF_PORT", "0"))),
        handler(identity, records, origin),
    )
    server.daemon_threads = True
    print(
        f"Non-shipped basic-session fixture ready on loopback port {server.server_port}; MFA/login lifecycle not implemented.",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
