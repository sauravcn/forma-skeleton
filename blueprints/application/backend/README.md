# Included synthetic records API

This is a public development example, not an authenticated or production server. No password, two-factor, OAuth provider, payment, license issuance or business-agent operation is implemented. Never store real customer/patient data here. The included Python source has standard-library runtime dependencies only and does not import either seller repository or a private SDK.

From the generated app root:

```sh
python3 backend/server.py
python3 -m unittest discover -s backend/tests -v
```

`API_PORT` defaults to 8765; the server always binds loopback `127.0.0.1`. `DATABASE_PATH` overrides the default `backend/data/records.sqlite3`; retain an existing path when restarting. Start an isolated verification instance by setting a temporary database path, not by resetting another database. The app's root launcher may supply a different API port and corresponding frontend server-only `FORMA_BACKEND_URL`.

`GET /api/health` returns ready, public-synthetic mode and authentication none. `GET /api/records` returns `{records}` ordered newest first. `POST /api/records` accepts required title (trimmed, 1–200 characters) and optional details (up to 2000 characters). It returns the new todo record with revision 1. `PATCH /api/records/<positive-id>` requires status todo/done and expected_revision; only status changes are accepted. A stale revision returns 409 without modifying the record. Records include stable integer ID, title, details, status, revision and UTC created_at/updated_at. Money, clinical and other business policies do not belong to this neutral example.

Request objects reject unknown fields; bodies must be bounded JSON objects (16 KiB maximum), without duplicate keys or nonfinite numbers. Error responses have stable `error_code`/`error_params` fields, translated by the frontend; local SQL, paths and request contents are not exposed. Foreign Host headers and write Origins are rejected. Direct native clients may omit Origin because this is deliberately public, not authentication. No CORS permission is granted. The frontend must use its same-origin bridge and validate write Origin before forwarding to the fixed configured loopback backend. Optional `ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist for native/development setups; it does not enable CORS or authentication.

Numbered SQL migrations are applied transactionally and their SHA-256 checksums retained. Applied migration source files must remain present and unchanged; startup rejects a missing applied file even when other SQL files remain. Add a new migration instead of editing/deleting history. Initialization creates tables only and does not seed or reset records. Author migration files with complete SQL statements ending on their own line. Review and locally back up retained data before upgrading. Runtime databases are not source artifacts.

Optional packaging uses normal third-party build tooling, not a runtime requirement:

```sh
python3 -m pip wheel --no-deps --wheel-dir /tmp/starter-api-wheels backend
```

The wheel includes migration SQL and local package source. Its installed `starter-records-api` console script defaults to `.starter-data/records.sqlite3` under the current working directory, not a writable path inside installed package source; set DATABASE_PATH explicitly for a retained deployment. Root generated-app consumer tests must still prove external installation/build/start, HTTP flow and restart persistence; these source tests do not substitute for that acceptance. Future identity and production deployment are separately ticketed capabilities.
