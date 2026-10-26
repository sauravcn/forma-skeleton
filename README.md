# Forma Skeleton

The canonical source home for Forma's reusable application blueprint and future app generator, selected by Saurav on October 25, 2026.

**Current state: executable configuration validation is implemented and tested; generator/templates are the next milestone.** The first blueprint explicitly permits only a public synthetic/no-auth starter. Password/2FA, social sign-in, hosting, licensing and guided AI remain separately unfinished; unsupported choices fail rather than generate fake capabilities.

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
4. Install dependencies with `npm ci`, run `npm test` and `npm run check:config` for the executable contract. A host with an unavailable default npm cache can use `--cache .run/npm-cache`. There is not yet a runnable generated app or published `npx create-forma-app` package.

You may clone this source independently:

```sh
git clone https://github.com/sauravcn/forma-skeleton.git
```

Cloning the application repository alongside it can help an authorized developer inspect the existing tracker/apps, but it must never become a hidden generator build/runtime dependency. Existing apps continue to run from their own repository using its local-resume instructions.

## Planned source homes

- `tools/create-forma-app/`: validated CLI and local packaged distribution.
- `blueprints/application/`: neutral versioned frontend, Python backend and included foundation source, plus optional modules.
- `tests/blueprint-consumers/`: generated-output, installed-package and safe-upgrade verification.

These paths describe future implementation locations; empty directories are not treated as working capabilities. The source/module contract specifies app config, themes/navigation, manifests, identity limits and the next runnable external-consumer proof. Existing apps adopt released changes in stages rather than being automatically moved or rewritten.

## Team and operating limits

Saurav is VP of Engineering; Codex leads the AI engineering roles Aarav (frontend/themes/navigation), Saurya (backend/identity/security) and Shreesh (generator/distribution/upgrades). The shared tracker holds actual owners, reviewers, acceptance criteria and evidence. Role/profile records do not create permanently running engineers, a live local-chat connection or a hosted ticket service.

The maintained Node-auth/Python identity boundary still needs its dedicated design/testing; a themed login or hidden navigation cannot authorize an API. Managed hosting, customer-specific licensing, guided nontechnical AI customization and a shared hosted issue service are separate workstreams. No secrets, customer databases, paid infrastructure or production deployment are part of this initialization.
