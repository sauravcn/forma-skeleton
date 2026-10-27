# {{APP_NAME}}

This generated source profile uses password sign-in with mandatory authenticator TOTP or recovery confirmation. Live external providers are not configured. Optional explicitly local MOCK Google/Facebook/GitHub/Microsoft/Apple sign-in is available for development. All required Forma identity, presentation and records authorization source is physically included; ordinary maintained dependencies install from package-lock.json. No seller checkout or private package is required.

Use Node 22+, Python 3 and isolated PostgreSQL. Run `npm ci`, `npm test` and `npm run build`. Configure the explicit app-owned database, identity secret, organization, loopback ports and SMTP transport described in `identity/node/README.md`, then run `npm run migrate` against fresh owned stores before `npm start` (or `npm run dev`). Authenticated start/migration entrypoints accept exported environment variables and optionally load an ignored local `.env`; `.env.example` is documentation and is not loaded directly. Never use production or another app's store for experimentation.

The generated authentication profile is fixed in source. Editing app.config.json cannot downgrade it. Navigation visibility never grants permission. The Python API checks the current maintained session, assurance, organization, role and ownership on each operation. Registration does not grant administrator authority.

Authenticator enrollment URIs, recovery codes, verification/reset links and cookies are credentials. Keep them out of logs, screenshots, Git and browser storage. Email acceptance does not prove delivery; normal startup requires a configured transport. Synthetic private test capture does not establish live mail acceptance.

This is local development source, not a production hosting or security certification. Review the identity/domain README files for current limits, mail operations, key handling and migration requirements. No license grant, payment service or live AI capability is implied.


## Optional MOCK social development

After the explicit app-owned PostgreSQL/domain/mail setup, set FORMA_MOCK_OAUTH=1, FORMA_ENVIRONMENT=local and NODE_ENV=development and run `npm run dev`. Production/optimized serving refuses mocks. The five provider buttons/consent pages are visibly MOCK and use no real social account or provider credential. A new verified synthetic account must create a local password, enroll TOTP and receive explicit operator membership before records access.

Privately admit the existing verified synthetic account using `node identity/node/bootstrap-admin.mjs --approve-member --email google.primary@synthetic.test --role admin`. Alternative --user-id selection is supported; do not supply both. Without --approve-member, the original bootstrap command still requires an already approved verified member. No public operator endpoint, first-signup promotion or implicit email account linking is provided. Keep environment/SMTP/database credentials private. Provider simulation does not provision services or prove live mail/provider delivery.
