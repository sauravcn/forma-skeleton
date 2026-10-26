"""Loopback-only public synthetic API. Not a production/authenticated server."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from .repository import Problem, Repository


MAX_BODY = 16384


def parse_json(raw):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("Nonfinite JSON number")

    return json.loads(
        raw, object_pairs_hook=object_pairs, parse_constant=invalid_constant
    )


def make_handler(repository, allowed_origins=None):
    origins = frozenset(
        allowed_origins or ("http://127.0.0.1:3000", "http://localhost:3000")
    )

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            # Request URLs/bodies may contain user input; do not log them by default.
            pass

        def reply(self, status, data):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def check_request(self, method):
            try:
                hosts = self.headers.get_all("Host", [])
                if len(hosts) != 1:
                    raise ValueError()
                host = urlsplit("//" + hosts[0])
                if (
                    host.hostname not in ("127.0.0.1", "localhost")
                    or host.username
                    or host.password
                ):
                    raise ValueError()
                host.port
            except ValueError:
                raise Problem("records.error.origin", 403)
            if len(self.path) > 2048:
                raise Problem("records.error.request", 414)
            if method != "GET":
                origin = self.headers.get("Origin")
                if origin is not None and origin not in origins:
                    raise Problem("records.error.origin", 403)

        def body(self):
            if self.headers.get("Transfer-Encoding") is not None:
                raise Problem("records.error.request", 400)
            if (
                self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                != "application/json"
            ):
                raise Problem("records.error.request", 415)
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]):
                raise Problem("records.error.request", 400)
            if len(lengths[0]) > 8:
                raise Problem("records.error.request", 413)
            size = int(lengths[0])
            if not 0 < size <= MAX_BODY:
                raise Problem("records.error.request", 413)
            try:
                data = parse_json(self.rfile.read(size).decode("utf-8"))
            except (UnicodeError, ValueError, RecursionError):
                raise Problem("records.error.invalid")
            if not isinstance(data, dict):
                raise Problem("records.error.invalid")
            return data

        def dispatch(self, method):
            try:
                self.connection.settimeout(5)
                self.check_request(method)
                path = urlsplit(self.path).path.rstrip("/")
                if method == "GET" and path == "/api/health":
                    return self.reply(200, repository.ready())
                if method == "GET" and path == "/api/records":
                    return self.reply(200, {"records": repository.records()})
                if method == "POST" and path == "/api/records":
                    return self.reply(201, repository.create(self.body()))
                match = re.fullmatch(r"/api/records/([1-9][0-9]{0,18})", path)
                if method == "PATCH" and match:
                    ident = int(match[1])
                    if ident > 9223372036854775807:
                        raise Problem("records.error.notFound", 404)
                    return self.reply(200, repository.transition(ident, self.body()))
                if method not in ("GET", "POST", "PATCH"):
                    raise Problem("records.error.request", 405)
                raise Problem("records.error.notFound", 404)
            except Problem as error:
                self.reply(error.status, {"error_code": error.code, "error_params": {}})
            except TimeoutError:
                self.reply(
                    408, {"error_code": "records.error.request", "error_params": {}}
                )
            except Exception:
                # Avoid exposing local paths, SQL, request contents or credentials.
                self.reply(
                    500, {"error_code": "records.error.request", "error_params": {}}
                )

        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

        def do_PATCH(self):
            self.dispatch("PATCH")

        def do_OPTIONS(self):
            self.dispatch("OPTIONS")

        def do_DELETE(self):
            self.dispatch("DELETE")

        def do_PUT(self):
            self.dispatch("PUT")

    return Handler


def make_server(repository, port=0, allowed_origins=None):
    server = ThreadingHTTPServer(
        ("127.0.0.1", port), make_handler(repository, allowed_origins)
    )
    server.daemon_threads = True
    return server


def main():
    try:
        port = int(os.environ.get("API_PORT", "8765"))
        if not 0 <= port <= 65535:
            raise ValueError()
    except ValueError:
        raise SystemExit("API_PORT must be an integer from 0 to 65535")
    default = Path.cwd() / ".starter-data/records.sqlite3"
    repository = Repository(os.environ.get("DATABASE_PATH", str(default)))
    repository.initialize()
    origins = os.environ.get("ALLOWED_ORIGINS")
    server = make_server(repository, port, origins.split(",") if origins else None)
    print(
        f"Public synthetic records API ready on loopback port {server.server_port}; authentication is not implemented.",
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
