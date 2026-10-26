# {{APP_NAME}}

A standalone **public synthetic development starter**. It has no sign-in, two-factor authentication, social provider, real payment, customer license issuance, production tenancy or hosting. Do not enter real patient/customer data. Unsupported authentication selections are refused by the generator.

All required starter source is in this directory. The included root lockfile pins the approved starter dependency graph; use npm ci for reproducible dependency installation. Neither Forma seller repository nor a private Forma package registry is needed. The frontend uses declared Next.js/React dependencies; the Python API uses stdlib SQLite and local migration source. `app.config.json` owns the app name/theme/navigation; source under frontend/backend is yours to modify under the applicable agreement, not an automatic copyright transfer or customer purchase entitlement.

## Local setup

Requires Node 22+ with npm and Python 3.11+:

```sh
npm ci
npm test
npm run build
npm start
```

`npm run dev` starts both services with the Next development server instead. Stop with Ctrl+C; the launcher supervises and stops both services. `WEB_PORT` defaults to 3000, `API_PORT` defaults to 8765; choose different unoccupied ports explicitly if necessary. The backend URL is derived server-side from API_PORT and is never accepted from client requests. `PYTHON_BIN` may select the local Python executable. `DATABASE_PATH` selects an isolated SQLite file; otherwise the backend initializes its own ignored backend/data file and never resets an existing database. No owner's databases or secrets were copied here.

The loopback frontend exposes same-origin synthetic-record and health routes. Direct API access is still a public local demo, not authenticated production access. Editing navigation visibility does not provide authorization. Full English labels, neutral styles and the app-owned component registry are source-local; selecting locale does not convert monetary values.

The included `.env.example` documents only local launcher settings. The launcher reads exported environment variables and does not automatically load an `.env` file; set values explicitly in your shell or approved local environment manager. No authentication secrets are provided.

## Source and recovery

`blueprint.lock.json` records exact blueprint/module versions, source revision/dirty state and baseline digests. `SOURCE_MANIFEST.json` inventories delivered files (excluding itself and documented generation-marker metadata). Hashes provide content provenance, not a license signature or tamper-proof update system. Keep your own Git history before customizing.

Generation refuses any existing destination. It assembles in a sibling staging directory, exclusively reserves a new destination, transfers files and removes `.forma-generation.pending` only on success. The destination can briefly be visible as pending; this is not a portable whole-directory transaction. If interrupted, preserve/inspect the pending marker/output and create a new destination or perform deliberate recovery. Never delete an existing customized app to retry generation.

The root launcher is included source, not an external service. A blueprint upgrade tool, real authentication and guided AI customization remain separate work. Retain THIRD_PARTY_NOTICES and upstream package notices when redistributing dependencies. Contact your seller for the actual source-use agreement; this development starter creates no purchase license.

## Developer coding assistants

AGENTS.md documents source ownership, extension locations, domain constraints and review commands for your chosen developer assistant. contracts/records.openapi.json describes the current public synthetic API; it does not create authenticated runtime-agent access or a guided customization service. No coding assistant is automatically running, and prompt-generated changes require developer review and actual tests.
