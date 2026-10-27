# Forma Skeleton

Forma's source-owned application blueprint and local app generator. The owner selected this repository as the blueprint source home; existing business apps and the [single numbered tracker](https://github.com/sauravcn/forma-kernel-care-center/blob/feature/cloud-functional-apps/tracking/BOARD.md) remain in `forma-kernel-care-center`.

Two development profiles are implemented:

- **public**: synthetic, no authentication, SQLite records.
- **password-totp**: maintained username/email/password verification/reset, mandatory authenticator TOTP/recovery, server-verified sessions and owner-scoped records. Identity uses an explicitly configured isolated PostgreSQL store; domain records use a separately scoped SQLite store.

The actual independently generated authenticated app passed installed-package/browser acceptance with private synthetic mail capture. This proves the tested development flows, not live email delivery, social sign-in, production hosting or a security certification. Per-agent review and integration are recorded in GitHub PR history. Providers remain absent; unsupported combinations fail before output. The CLI is a locally packed private distribution, not a published npm package.

## Generate a complete child

Node22+, npm and Python3.11+ are required. From a fresh checkout:

```sh
npm ci
npm test
npm pack ./tools/create-forma-app --pack-destination /tmp
mkdir /tmp/forma-generator-install
cd /tmp/forma-generator-install
npm install /tmp/create-forma-app-0.1.0.tgz
npm exec -- create-forma-app /tmp/my-app --yes --id my-app --name "My App"
cd /tmp/my-app
npm ci
npm test
npm run build
npm start
```

Choose new destination/install directories; existing paths are refused. The default public starter runs on http://127.0.0.1:3000. Its generated README documents WEB_PORT/API_PORT and an isolated DATABASE_PATH. Generation is an explicitly marked staging/completion process, not a whole-directory transaction.

For authenticated output, use `--profile password-totp` during generation. Read that child's README and `.env.example`, configure explicit fresh PostgreSQL/domain stores, secret, organization, loopback origin and TLS SMTP transport, run `npm run migrate`, then start. Runtime refuses uninitialized/foreign stores and config-only security downgrades. Normal startup requires SMTP configuration; it has no test-login or verification bypass. Do not copy owner credentials or runtime databases into generated children. Self-service verification grants ordinary membership; administrator bootstrap is an explicit documented operator command.

Each child physically includes all required Forma frontend/backend/identity/policy/migration source, declared ordinary third-party dependencies/notices and source provenance. It needs neither seller checkout, Kernel sessions nor a private Forma registry. Seller purchase verification, license signing keys, unrelated products and customer forks are excluded. Source access does not grant copyright transfer or exclusivity.

## Customize and extend

The child owns its semantic theme tokens, full component/source replacements, English catalogs and validated navigation JSON. Sidebar, top, combined and mobile navigation retain stable IDs. Parent controls cover typography, colors, focus, spacing, radius and motion; structural changes use source/registry replacement. See the [theme contract](docs/architecture/theme-contract.md) for exact bounds. Authentication and domain authorization remain server-enforced regardless of component/nav replacement.

Generated AGENTS.md and a machine-readable records OpenAPI contract support reviewed developer-assistant customization. They do not provide a hosted prompt service or start an autonomous agent. Safe customer upgrades, social providers, guided nontechnical AI customization, purchase licensing, managed hosting and existing-app adoption remain separately unfinished. FORMA-0016 remains open.

## Verification

`npm test` covers configuration, CLI and public frontend/backend regressions. Additional explicit checks:

- `npm run test:consumer`: external packed CLI, source closure, npm ci/test/build/start, public HTTP writes/conflicts, persistence and cleanup.
- `npm run test:authenticated-consumer`: external authenticated child, actual browser registration/verification/password/enrollment/TOTP/recovery/reset/logout, copied-cookie revocation, two-user ownership denial, responsive login and output-secret checks. Requires Docker with cached `postgres:17-bookworm` and Chromium (`CHROMIUM_PATH` may override). Synthetic email travels solely through private process IPC to injected mail capture; no public test endpoint is added.
- `npm run test:identity-lifecycle` and `npm run test:identity-boundary`: maintained PostgreSQL/session/assurance and actual Python trust-boundary regressions using disposable stores.
- `node --test tests/blueprint-consumers/test-auth-store.mjs`: fresh-store, foreign-view, interrupted migration and scope-preservation counterexamples.
- `npm run test:python-package`: isolated installed Python wheel/SQL/console persistence proof.
- After `test:consumer`, `test:visual`, `test:navigation`, `test:auth-presentation`, `test:presentation-accessibility` and `test:theme-contract` exercise their documented copied-source/browser scopes. View-only presentation proofs do not replace real identity acceptance.

Ignored `.run/` artifacts are local evidence, not Git backups. Tests create/remove only their own synthetic stores and processes. No full WCAG, translated-language, arbitrary-theme contrast, live SMTP/OAuth or production-operation guarantee is inferred.

Actual generated-app captures: [desktop sign-in](docs/screenshots/authenticated-login-desktop.png), [mobile sign-in](docs/screenshots/authenticated-login-mobile.png), [protected records](docs/screenshots/authenticated-records.png). Enrollment secrets are never captured. Earlier public and parent-theme captures remain under docs/screenshots.

## Engineering continuity

Read [AGENTS.md](AGENTS.md), [TODO.md](TODO.md), [HANDOFF.md](HANDOFF.md), [TRACKING.md](TRACKING.md) and the [standalone contract](docs/architecture/standalone-contract.md). The user-named AI roles Aarav, Saurya and Shreesh work under Codex; they are active-task roles, not permanent services or independent GitHub identities. No outbound local-chat channel is verified.

Earlier checkpoints used direct main pushes and have no PR history. The [new PR workflow](docs/engineering/PULL_REQUEST_WORKFLOW.md) records the resolved network incident and required per-agent PR review sequence. The recovery snapshot remains on `feature/forma-0016-generator`; agent PRs integrate through the temporary review branch before the final reviewed main PR. Do not treat a feature checkpoint as a main merge. Local development must fetch/reconcile source, board and handoff before overlapping edits. Never discard local changes or copy runtime data to reconcile code.
