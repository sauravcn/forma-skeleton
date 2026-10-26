# Non-shipped identity boundary proof — FORMA-0039

This package is an isolated engineering fixture, not the generated app's login module. The public neutral blueprint still supports auth none only. It has not gained password, TOTP, recovery, OAuth, session-MFA assurance, production hosting or an authenticated-customer release. FORMA-0039 and the full identity/consumer stories remain open until their remaining lifecycle/assurance acceptance is met.

## What this proves

The fixture uses declared Better Auth 1.7.12 and pg 8.23.1 dependencies, its own disposable PostgreSQL and a stdlib Python domain API. It does not import either app-repository identity wrapper, private SDK or customer source. Synthetic users/sessions are created only by the test runner through maintained internal test-fixture APIs and the maintained cookie-signing helper. There is no login/test-login HTTP route, manually invented signature, custom JWT or MFA-complete flag. These fixture sessions establish only `basic-session-fixture` assurance, not a completed password or MFA challenge.

`src/identity.mjs` requires a complete explicit loopback PostgreSQL URL/credentials/port/database before constructing a pool; missing targets do not fall back to ambient PG variables. Maintained migrations run on that explicit target before the auth context starts. The auth service checks each opaque session through maintained database-backed getSession with cookie cache and refresh disabled, then queries current organization membership/role. Account linking, password and providers are disabled in this boundary proof.

`src/server.mjs` serves only GET `/internal/identity`. Its app/organization IDs come from trusted fixture configuration. It returns filtered user scope, current permissions, expiry and explicit basic assurance, never a raw session/provider token, arbitrary user profile or MFA secret. It ignores client-supplied identity/role/organization claims. Only the required maintained session cookie is passed to the auth library; duplicate required cookies deny.

`python/identity_client.py` uses a fixed loopback target, no redirects, no environment HTTP proxy, a two-second timeout and bounded response. It forwards only the configured child session cookie and rejects duplicate/missing credentials. It checks exact response shape, configured app/organization, expiry, permission values and fixture assurance. Expired credentials are 401, wrong scope is 403, unavailable/malformed identity is 503. No positive authorization cache or synthetic-principal fallback is used.

`python/protected_api.py` checks identity before each protected record read/create, enforces server-derived organization/ownership and current role, and requires the exact configured Origin for cookie-authenticated writes. Record owner/organization values are never taken from body/header fields. This is a deliberately small SQLite example, not a production API server or multi-tenant product. The non-sensitive health route identifies the proof and explicitly reports MFA is not implemented.

## Run the isolated proof

From the skeleton repository root after its normal dependency installation:

```sh
npm run test --workspace @forma/identity-boundary-proof
```

Requirements: Node22+, Python3.11+, a usable Docker daemon and the already-cached `postgres:17-bookworm` image. The harness uses `--pull never`; it does not silently provision remote infrastructure. Missing Docker/image is an explicit prerequisite failure, not a skipped/passing auth test. Current root dependency audit is maintained by Codex; this package does not publish or deploy anything.

The harness generates random synthetic credentials in a private temporary environment file, starts a uniquely named loopback-only PostgreSQL container with temporary storage, obtains its actual assigned port and initializes only that explicit test database. Python APIs use their own temporary SQLite file. It kills its own child services, closes its own pool, removes that uniquely named container/store and deletes the temporary files in cleanup. It never uses an owner's DATABASE_URL, Kernel PostgreSQL volume, Care SQLite, Google secret or application database.

Python parser/transport regression tests can be run separately without Docker:

```sh
python3 -m unittest discover -s packages/identity-boundary/test -p client_test.py -v
```

Those targeted tests use synthetic HTTP peers to verify expiry status, exact-cookie filtering, duplicate denial, hostile proxy environment isolation, redirect denial, response scope and assurance failure. They are not fake substitutes for the actual maintained PostgreSQL integration run.

## Actual acceptance covered

- Maintained PostgreSQL sessions authorize actual Python HTTP requests; missing, forged, expired and revoked credentials deny both reads and writes.
- Valid principals expose only the agreed minimal fields and basic fixture assurance.
- Foreign/missing write Origin and forged body owner values deny. Header role/user/organization assertions do not override the maintained identity.
- Two users cannot read each other's records; a user from a different organization cannot acquire authority by changing headers.
- Current database role/membership changes take effect without a positive authorization cache. Completed revocation denies subsequent access.
- A differently configured expected child audience rejects an otherwise valid principal.
- Stopping the identity service makes writes fail closed with 503; restarting it shows no rejected write was stored.
- No `/test-login`, public password sign-in or generic credential-creation route exists in this service.

The test boundary assumes a trusted local OS/process environment and fixed loopback peers; it is not proof against a malicious local administrator or a production authenticated service-to-service network. Real deployment requires maintained transport/TLS and operational acceptance. Requests already authorized before a concurrent revocation are not retroactively undone; separate-domain/identity transactions are not claimed atomic.

Still open: full maintained password/verification/reset and real mail delivery; TOTP/recovery/enrollment/step-up/trusted-device policy; session-bound MFA assurance; provider callbacks and local-MFA combinations; record/data adoption migrations; generated identity source/module configuration; production secrets, TLS, CSRF and rate-limit operations; full authenticated independent-consumer proof. None of those capabilities may be enabled in the blueprint manifest based only on this fixture.
