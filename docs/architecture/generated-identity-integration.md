# Generated identity integration gate — FORMA-0176

Implementation plan, 2026-10-26. Separate view/backend proofs are not a working generated authenticated app. Default public-synthetic/no-auth generation must keep its existing behavior. The first supported authenticated profile will be password plus mandatory authenticator TOTP/recovery, with providers absent; unsupported social/password-only combinations remain rejected until separately accepted. No production hosting, live mail/provider acceptance or licensing is implied.

## Source and assembly interfaces

- Keep canonical maintained identity implementation in packages/identity-lifecycle and the principal transport in packages/identity-boundary. CLI prepack vendors pinned original source into its own blueprint snapshot, with revision/content origin records. It must never download seller code or depend on another checkout. Generated children receive physical source, ordinary declared dependencies and notices, never a private Forma runtime import.
- Add optional blueprint modules below blueprints/application/modules: identity owns Node identity/session transport and frontend identity controller/presentation; records-auth owns the domain-specific Python records authorization, migrations and permission policy. Foundation identity must not import domain code. The application composition supplies its role/permission policy explicitly.
- Base frontend routes/pages call generated known adapter files frontend/src/identity-server.mjs and identity-client.jsx. The CLI chooses fixed public stubs or authenticated adapters as reviewed source assets. Public stubs keep record transport unchanged and expose no decorative login. No arbitrary JS is interpolated from user JSON; source collisions still fail before writes.
- Profile metadata declares supported auth tuples and required modules. Validation resolves their complete source closure and rejects incompatible selection. Default public dependency lock remains separate from the authenticated workspace lock. Existing destinations are never overwritten.

## Runtime boundary

Use a child-owned Node HTTP/Next application composition so the maintained auth handler sees the actual socket peer, rather than trusting forwarded client IP headers. Mount maintained auth endpoints and a minimal identity descriptor/introspection handler before Next; serve pages/record bridges with fixed loopback service targets. Same-origin cookies/challenges stay maintained-library controlled. Python verifies current principal/assurance/role/owner on every protected operation. No UI flag, first signup, navigation visibility, license metadata or header selects authority.

The optional auth view source gets actual controller bindings: registration, verification, password sign-in/reset, TOTP enrollment/confirmation, challenge/recovery and sign-out. Add transient authorized enrollment URI/recovery display, with local QR rendering if supplied; never use an external QR service. Sensitive state stays in memory/cookies, never storage/logs. Provider buttons stay absent. Errors and generic email acceptance remain localized and truthful.

A programmatic app factory accepts an explicitly configured mail transport; the default start command requires documented SMTP configuration and rejects placeholders/missing settings. Tests may inject private in-memory synthetic mail capture into that factory, then follow actual maintained verification/reset links in the browser. There is no HTTP test-login/verification bypass and no claim that capture is live delivery. Do not log token-bearing URLs through Next/access logs; test output for secret leakage.

## Store and downgrade safety

Explicit fresh-store setup/migration commands precede runtime. Bind app/organization/security profile in owned PostgreSQL/SQLite metadata before migrations; refuse a populated foreign/unmarked store rather than adopting it or assigning old rows to the first signup. Require new isolated synthetic stores in tests. Preserve applied migration checksums and retained data. Authentication selection is fixed by the generated source profile: config-only downgrade must fail, and a public server must not read an authenticated store.

Records retain stable IDs/revisions and original response fields; ownership/organization are server-derived fields, not accepted input. Keep app-specific permission policy in records-auth. First signup receives only the app's normal member policy; privileged bootstrap is an explicit operator action requiring the security profile, never first-browser promotion.

## Acceptance

Generate from an installed packed CLI outside seller repos, npm ci/test/build, migrate disposable PG/domain stores, and run the actual app. Browser flows must verify registration/mail link, sign-in, enrollment/TOTP, recovery, reset and sign-out; two users cannot read/write each other's records. Direct missing/forged/pending/revoked/insufficient-assurance API calls deny. Assert public-profile regressions, source/lock/notice closure, no secret output and supervised cleanup. A successful component fixture or directory copy does not close this gate.

## Assigned integration interfaces

Selected modules map `modules/identity/runtime` to child `identity/`, and `modules/records-auth/runtime` to child `backend-auth/`. Identity canonical core is vendored from the two packages and optional identity-ui presentation by CLI prepack; records-auth's immutable initial records SQL is vendored from the base template. Module/node/package locks must remain self-contained.

Generated server adapter exports `assertProfile(config)`, `requirePageAccess()`, `requireAuthPage()` and `proxyRecords(request, resource)`. Public adapter delegates the existing public record bridge; public auth page is unavailable. Auth adapter composes identity Next helpers and domain record transport, with no database work at import/build time. Client adapter exports `IdentityProvider`, `IdentityControls`, `useIdentity` and `AuthPage`; public variants have no auth calls/buttons and preserve existing write behavior. Base pages/routes import only these generated selectors.

Backend supplies `identity/node/application.mjs` programmatic app factory and start/migration entrypoints, `identity/node/next-adapter.mjs`, and records-auth domain server/transport/permission policy. Programmatic factory takes explicit project configuration and injectable `sendMail`/redacted failure callback for private test capture; normal startup requires real documented mail configuration. Descriptor stages are `signed-out`, `enroll`, `challenge`, `authenticated`, or `forbidden`, derived solely by the server; no stage grants Python permission. Client submits only maintained endpoint fields. Its enrollment/recovery/reset secrets remain transient and never enter storage/logs.

Generator owns profile validation/module closure, selector source assets, canonical vendoring, source manifests/notices, profile-specific npm lock and root commands. Frontend owns the common selector call sites and optional identity UI/controller; backend owns runtime/domain/migration source. Canonical schema/generator files have one writer. Lead owns cross-profile E2E proof and main promotion.
