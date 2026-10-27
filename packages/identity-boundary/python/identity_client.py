"""Authoritative per-request session introspection; no custom token cryptography."""

from datetime import datetime, timezone
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class Denied(ValueError):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(code)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class IdentityClient:
    def __init__(
        self,
        url,
        app_id,
        organization_id,
        cookie_name,
        required_assurance="basic-session-fixture",
        *,
        allowed_permissions,
    ):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in ("127.0.0.1", "localhost")
            or parsed.username
            or parsed.password
            or parsed.path != "/internal/identity"
            or parsed.query
            or parsed.fragment
            or not parsed.port
        ):
            raise ValueError(
                "Identity proof requires a fixed loopback introspection target"
            )
        if not app_id or not organization_id:
            raise ValueError("Explicit child scope is required")
        if not isinstance(cookie_name, str) or not re.fullmatch(
            r"[A-Za-z0-9_.-]{1,160}", cookie_name
        ):
            raise ValueError("Explicit maintained session cookie name is required")
        if required_assurance not in ("basic-session-fixture", "mfa-session-v1"):
            raise ValueError("Explicit supported server assurance policy is required")
        if (
            not isinstance(allowed_permissions, (set, frozenset, tuple, list))
            or not 0 < len(allowed_permissions) <= 64
            or any(
                not isinstance(item, str)
                or not re.fullmatch(r"[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*", item)
                for item in allowed_permissions
            )
        ):
            raise ValueError("Explicit domain permission vocabulary required")
        self.allowed_permissions = frozenset(allowed_permissions)
        self.required_assurance = required_assurance
        self.url, self.app_id, self.organization_id = url, app_id, organization_id
        self.cookie_name = cookie_name
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def authorize(self, cookie):
        if (
            not isinstance(cookie, str)
            or not cookie
            or len(cookie) > 8192
            or "\r" in cookie
            or "\n" in cookie
        ):
            raise Denied(401, "identity.error.required")
        pairs = [
            value.strip()
            for value in cookie.split(";")
            if value.strip().partition("=")[0] == self.cookie_name
        ]
        if len(pairs) != 1 or not pairs[0].partition("=")[2]:
            raise Denied(401, "identity.error.required")
        request = Request(
            self.url,
            headers={"Cookie": pairs[0], "Accept": "application/json"},
            method="GET",
        )
        try:
            with self.opener.open(request, timeout=2) as response:
                raw = response.read(8193)
                if response.status != 200 or len(raw) > 8192:
                    raise ValueError("Invalid introspection response")
                principal = json.loads(raw)
        except HTTPError as error:
            if error.code in (401, 403):
                raise Denied(
                    error.code,
                    "identity.error.required"
                    if error.code == 401
                    else "identity.error.forbidden",
                )
            raise Denied(503, "identity.error.unavailable")
        except (URLError, TimeoutError, OSError, ValueError, RecursionError):
            raise Denied(503, "identity.error.unavailable")
        if not isinstance(principal, dict) or set(principal) != {
            "app_id",
            "organization_id",
            "user_id",
            "permissions",
            "expires_at",
            "assurance",
        }:
            raise Denied(503, "identity.error.unavailable")
        if (
            principal["app_id"] != self.app_id
            or principal["organization_id"] != self.organization_id
        ):
            raise Denied(403, "identity.error.forbidden")
        if (
            not isinstance(principal["user_id"], str)
            or not 0 < len(principal["user_id"]) <= 200
        ):
            raise Denied(503, "identity.error.unavailable")
        permissions = principal["permissions"]
        allowed = self.allowed_permissions
        if (
            not isinstance(permissions, list)
            or len(permissions) > len(allowed)
            or any(
                not isinstance(item, str) or item not in allowed for item in permissions
            )
            or len(set(permissions)) != len(permissions)
            or principal["assurance"] not in ("basic-session-fixture", "mfa-session-v1")
        ):
            raise Denied(503, "identity.error.unavailable")
        if (
            self.required_assurance == "mfa-session-v1"
            and principal["assurance"] != "mfa-session-v1"
        ):
            raise Denied(403, "identity.error.forbidden")
        try:
            expiry = datetime.fromisoformat(
                principal["expires_at"].replace("Z", "+00:00")
            )
        except (AttributeError, TypeError, ValueError):
            raise Denied(503, "identity.error.unavailable")
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            raise Denied(401, "identity.error.required")
        return principal
