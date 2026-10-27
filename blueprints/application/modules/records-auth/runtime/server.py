"""Loopback authenticated domain API; every protected request introspects current proof."""

from http.server import ThreadingHTTPServer
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from repository import Repository, Problem

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "identity/core/boundary/python"))
from identity_client import IdentityClient, Denied
from starter_api.server import make_handler as public_handler

ALLOWED_PERMISSIONS = frozenset(
    {"records:read", "records:write", "records:read:any", "records:write:any"}
)


def make_handler(repository, identity, origin):
    class Handler(public_handler(repository, [origin])):
        def dispatch(self, method):
            try:
                self.connection.settimeout(5)
                self.check_request(method)
                if self.path == "/api/health" and method == "GET":
                    return self.reply(200, repository.ready())
                if len(self.headers.get_all("Cookie", [])) != 1:
                    raise Denied(401, "identity.error.required")
                principal = identity.authorize(self.headers.get("Cookie", ""))
                if method != "GET" and self.headers.get_all("Origin", []) != [origin]:
                    raise Denied(403, "identity.error.origin")
                if self.path == "/api/records":
                    if method == "GET":
                        return self.reply(
                            200, {"records": repository.records(principal)}
                        )
                    if method == "POST":
                        return self.reply(
                            201, repository.create(principal, self.body())
                        )
                match = re.fullmatch(r"/api/records/([1-9][0-9]{0,18})", self.path)
                if method == "PATCH" and match:
                    ident = int(match[1])
                    if ident > 9223372036854775807:
                        raise Problem("records.error.notFound", 404)
                    return self.reply(
                        200, repository.transition(principal, ident, self.body())
                    )
                raise Problem("records.error.notFound", 404)
            except (Problem, Denied) as error:
                self.reply(error.status, {"error_code": error.code, "error_params": {}})
            except TimeoutError:
                self.reply(
                    408, {"error_code": "records.error.request", "error_params": {}}
                )
            except Exception:
                self.reply(
                    503,
                    {"error_code": "identity.error.unavailable", "error_params": {}},
                )

    return Handler


def main():
    try:
        origin = os.environ["FORMA_PUBLIC_ORIGIN"]
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in ("127.0.0.1", "localhost")
            or not parsed.port
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or origin != f"http://{parsed.hostname}:{parsed.port}"
        ):
            raise ValueError()
        port = int(os.environ["API_PORT"])
        if not 1 <= port <= 65535:
            raise ValueError()
        repo = Repository(
            os.environ["DATABASE_PATH"],
            os.environ["FORMA_APP_ID"],
            os.environ["FORMA_ORGANIZATION_ID"],
        )
        repo.ready()  # Runtime never creates or migrates stores.
        identity = IdentityClient(
            os.environ["PROOF_IDENTITY_URL"],
            repo.app_id,
            repo.organization_id,
            os.environ["PROOF_SESSION_COOKIE_NAME"],
            "mfa-session-v1",
            allowed_permissions=ALLOWED_PERMISSIONS,
        )
        server = ThreadingHTTPServer(
            ("127.0.0.1", port), make_handler(repo, identity, origin)
        )
        server.daemon_threads = True
    except Exception:
        raise SystemExit(
            "Authenticated domain configuration/store is invalid; explicit setup required"
        )
    print("Authenticated domain API ready on loopback", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
