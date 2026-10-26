# Forma Skeleton

The canonical source home for Forma's reusable application blueprint and app generator, selected by Saurav on October 25, 2026.

**Current state: an executable local generator and independently runnable neutral starter are implemented.** The first blueprint explicitly permits only a public synthetic/no-auth starter. Password/2FA, social sign-in, hosting, licensing and guided AI remain separately unfinished; unsupported choices fail rather than generate fake capabilities.

## Repository boundaries

| Repository/output | Owns |
| --- | --- |
| **forma-skeleton** (this repository) | Future CLI, versioned copied-source blueprints/modules, provenance/upgrade contracts and standalone consumer tests |
| [forma-kernel-care-center](https://github.com/sauravcn/forma-kernel-care-center) | Existing business apps and data ownership, Kernel commerce/license issuance and the current global engineering tracker |
| A generated customer repository | Complete required app/foundation source, app-owned theme/navigation/domain logic and its own installation/runtime configuration |

The selected skeleton source and generator distribution must build and operate without a sibling private application checkout. A generated customer app must be independent of **both** seller repositories, private Forma package services and seller Kernel sessions. Required Forma source must be physically included in a future delivered child; normal declared third-party dependencies/notices remain. Seller signing private keys, purchase verification, unrelated products, customer confidential forks, credentials and runtime databases are excluded.

Source extraction from existing application libraries is future reviewed work: pin the upstream revision, include the full dependency/source closure, record adaptations and provenance, and verify with the sibling checkout absent. This README is not evidence that source extraction has happened. Source access remains governed by the agreed license; no copyright transfer or exclusivity is granted by this repository.

## Start here

1. Read [AGENTS.md](AGENTS.md), [TODO.md](TODO.md), [HANDOFF.md](HANDOFF.md) and the [standalone source/module contract](docs/architecture/standalone-contract.md).
2. Use [TRACKING.md](TRACKING.md) for the shared work board, coverage, roster and coordination links. There is **one global FORMA ticket series**, not a second skeleton backlog.
3. Fetch/inspect source and dirty state, get the lead's assigned ticket/file scope, and preserve existing work. Do not run application setup/migrations or copy local databases merely to initialize this repository.
4. Install dependencies with `npm ci`, run `npm test` and `npm run check:config` for the executable contract. A host with an unavailable default npm cache can use `--cache .run/npm-cache`. The CLI is locally packaged; it is not published to npm. See the generation commands below.

You may clone this source independently:

```sh
git clone https://github.com/sauravcn/forma-skeleton.git
```

Cloning the application repository alongside it can help an authorized developer inspect the existing tracker/apps, but it must never become a hidden generator build/runtime dependency. Existing apps continue to run from their own repository using its local-resume instructions.

## Source homes

- `tools/create-forma-app/`: validated CLI and local packaged distribution.
- `blueprints/application/`: neutral versioned frontend, Python backend and included foundation source, plus optional modules.
- `tests/blueprint-consumers/`: generated-output, installed-package and safe-upgrade verification.

These paths contain the current generator, source templates and consumer verification. The source/module contract specifies app config, themes/navigation, manifests, identity limits and the next runnable external-consumer proof. Existing apps adopt released changes in stages rather than being automatically moved or rewritten.

## Team and operating limits

Saurav is VP of Engineering; Codex leads the AI engineering roles Aarav (frontend/themes/navigation), Saurya (backend/identity/security) and Shreesh (generator/distribution/upgrades). The shared tracker holds actual owners, reviewers, acceptance criteria and evidence. Role/profile records do not create permanently running engineers, a live local-chat connection or a hosted ticket service.

The maintained Node-auth/Python identity boundary still needs its dedicated design/testing; a themed login or hidden navigation cannot authorize an API. Managed hosting, customer-specific licensing, guided nontechnical AI customization and a shared hosted issue service are separate workstreams. No secrets, customer databases, paid infrastructure or production deployment are part of this initialization.
## Generate a neutral app locally

```sh
npm ci
npm test
npm pack ./tools/create-forma-app --pack-destination /tmp
mkdir /tmp/forma-generator-install
cd /tmp/forma-generator-install
npm install /tmp/create-forma-app-0.1.0.tgz
npm exec -- create-forma-app /tmp/my-neutral-app --yes --id my-neutral-app --name "My Neutral App" --theme linen --navigation sidebar
cd /tmp/my-neutral-app
npm ci
npm test
npm run build
npm start
```

Use fresh destination/install directories. Node 22+, npm and Python 3.11+ are required. Open http://127.0.0.1:3000. WEB_PORT/API_PORT select unused ports; DATABASE_PATH selects a new isolated SQLite file. Stop with Ctrl+C. Never replace an existing app/database to retry generation. Consult the generated README for environment, provenance and recovery details.

Implemented: app-owned frontend/backend source, strict configuration, pinned dependency lock, English catalog, linen/midnight themes, sidebar/top/combined/mobile navigation with a validated source-local JSON manifest, source-replaceable shell/components, SQLite record creation/status updates with revision conflicts and persistence, safe destination refusal, and installed-tarball consumer checks. Generation has explicit pending/completion markers; it is not a whole-directory transaction.

Run `npm run test:python-package` for an offline-installed wheel/SQL/console/restart proof in an isolated Python environment (building may fetch ordinary build tooling). Run `npm run test:consumer` for independent pack/install/generate/test/build/HTTP/restart proof. Run `npm run test:visual` afterward for Chromium verification of six theme/layout combinations and a complete source shell replacement; Chromium is required (CHROMIUM_PATH may override the executable). Artifacts go under ignored .run/neutral-consumer. These are public synthetic development checks, not production security or full accessibility certification.

Still unfinished: real login/password/TOTP/recovery/social providers, protected identity/roles, safe upgrades, AI customization, purchase licensing, managed hosting and existing-app adoption. FORMA-0016 stays open. A local tarball is not a published npm release, commercial license or owner product acceptance.

Rendered examples from the external generated child: [desktop](docs/screenshots/neutral-linen-sidebar.png) and [mobile](docs/screenshots/neutral-midnight-mobile.png). These are actual synthetic starter captures, not designs for the existing business apps.

Developer-assistant guidance and a machine-readable public records API contract are delivered in generated AGENTS.md and contracts/records.openapi.json. They support reviewed developer customization; they do not start an agent or provide a hosted prompt service.

The separate packages/identity-boundary engineering fixture exercises maintained PostgreSQL sessions and server-derived Python ownership with `npm run test:identity-boundary` (Docker and cached postgres:17-bookworm required). It is not bundled into generated apps and does not implement password/TOTP/provider lifecycle. See its README and the identity design for exact limits.

After a fresh `npm run test:consumer`, run `npm run test:navigation` for nested-manifest and keyboard/modal/focus checks across the three renderers. It modifies only the temporary generated example and uses its own synthetic database.

Optional identity presentation remains outside generated output. After test:consumer, `npm run test:auth-presentation` copies the module into a fresh dependency-installed fixture and checks controlled views, parent styles and complete layout replacement. Actual view-only captures: [split desktop](docs/screenshots/auth-view-split-desktop.png), [minimal mobile](docs/screenshots/auth-view-minimal-mobile.png).

`npm run test:identity-lifecycle` exercises the separate maintained username/email/password, verification/reset and revocation candidate with disposable PostgreSQL and synthetic in-memory mail capture. Mail responses do not assert delivery; explicit transport and redacted failure monitoring are required. This candidate is not bundled or enabled in the starter; Real mail acceptance and full generated identity integration remain open.

The lifecycle candidate can explicitly enable maintained authenticator TOTP/recovery via trusted server option enableTotp (default false). Its actual tests cover pending enrollment, first-factor/challenge boundaries, expiry/replay, encrypted recovery single-use and HTTP429 abuse limits. This does not enable auth in generated apps or establish session-assurance/production key rotation.

`npm run test:presentation-accessibility` checks English placeholder contracts, RTL/long-label views and the base record/navigation flow using its own copied source, API and synthetic database. Geometric tests prevent menu labels overlapping other content. This is bounded engineering evidence, not translated-language acceptance or full WCAG certification.

The private identity candidate now binds maintained MFA proofs to real session IDs and persisted security epochs. Actual Python integration tests deny stale/basic/admin/forged authority, replayed counters and failed-proof operations; reset/revocation races and forwarded-IP budget bypass are covered. These are verified components, while generated-app integration is explicitly tracked by FORMA-0176.
