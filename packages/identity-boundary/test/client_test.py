"""HTTP parser/transport regressions on loopback synthetic peers only."""

from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from identity_client import Denied, IdentityClient as PrincipalClient


def IdentityClient(*args, **kwargs):
    return PrincipalClient(
        *args,
        allowed_permissions=frozenset(
            ("records:read", "records:write", "records:read:any", "records:write:any")
        ),
        **kwargs,
    )


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.peers = []

    def tearDown(self):
        for server, thread in self.peers:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def peer(self, response, status=200, location=None):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                received.append(
                    {"path": self.path, "cookie": self.headers.get("Cookie")}
                )
                payload = json.dumps(response).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                if location:
                    self.send_header("Location", location)
                self.end_headers()
                self.wfile.write(payload)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.peers.append((server, thread))
        return f"http://127.0.0.1:{server.server_port}/internal/identity", received

    def principal(self, expired=False):
        return {
            "app_id": "proof-app",
            "organization_id": "proof-org",
            "user_id": "synthetic-user",
            "permissions": ["records:read"],
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(hours=-1 if expired else 1)
            ).isoformat(),
            "assurance": "basic-session-fixture",
        }

    def test_expired_principal_is_401_not_transport_failure(self):
        url, received = self.peer(self.principal(expired=True))
        with self.assertRaises(Denied) as failure:
            IdentityClient(url, "proof-app", "proof-org", "synthetic-cookie").authorize(
                "synthetic-cookie=unit-test"
            )
        self.assertEqual(failure.exception.status, 401)
        self.assertEqual(len(received), 1)

    def test_hostile_proxy_environment_never_receives_cookie(self):
        target, received = self.peer(self.principal())
        proxy, intercepted = self.peer({"unexpected": True})
        proxy_origin = proxy.rsplit("/internal", 1)[0]
        environment = {
            key: proxy_origin
            for key in (
                "HTTP_PROXY",
                "http_proxy",
                "HTTPS_PROXY",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
            )
        }
        environment.update(NO_PROXY="", no_proxy="")
        with patch.dict(os.environ, environment):
            principal = IdentityClient(
                target, "proof-app", "proof-org", "synthetic-cookie"
            ).authorize("synthetic-cookie=unit-test")
        self.assertEqual(principal["user_id"], "synthetic-user")
        self.assertEqual(len(received), 1)
        self.assertEqual(intercepted, [])

    def test_only_required_cookie_is_forwarded_and_duplicate_required_cookie_denies(
        self,
    ):
        target, received = self.peer(self.principal())
        client = IdentityClient(target, "proof-app", "proof-org", "synthetic-cookie")
        client.authorize(
            "unrelated-private=must-not-forward; synthetic-cookie=unit-test; tracking=drop"
        )
        self.assertEqual(
            received,
            [{"path": "/internal/identity", "cookie": "synthetic-cookie=unit-test"}],
        )
        with self.assertRaises(Denied) as failure:
            client.authorize("synthetic-cookie=first; synthetic-cookie=second")
        self.assertEqual(failure.exception.status, 401)
        self.assertEqual(len(received), 1)

    def test_redirect_is_not_followed_with_a_credential(self):
        destination, received = self.peer(self.principal())
        source, _ = self.peer({}, status=302, location=destination)
        with self.assertRaises(Denied) as failure:
            IdentityClient(
                source, "proof-app", "proof-org", "synthetic-cookie"
            ).authorize("synthetic-cookie=unit-test")
        self.assertEqual(failure.exception.status, 503)
        self.assertEqual(received, [])

    def test_wrong_app_org_and_assurance_fail_closed(self):
        for field, value, expected in (
            ("app_id", "wrong-app", 403),
            ("organization_id", "wrong-org", 403),
            ("assurance", "mfa-complete-from-client", 503),
        ):
            with self.subTest(field=field):
                principal = self.principal()
                principal[field] = value
                url, _ = self.peer(principal)
                with self.assertRaises(Denied) as failure:
                    IdentityClient(
                        url, "proof-app", "proof-org", "synthetic-cookie"
                    ).authorize("synthetic-cookie=unit-test")
                self.assertEqual(failure.exception.status, expected)


if __name__ == "__main__":
    unittest.main()
