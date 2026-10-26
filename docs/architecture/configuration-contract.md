# Executable configuration and extension contract

FORMA-0019. This contract is backed by `schemas/app-config.schema.json`, `schemas/blueprint.schema.json` and `packages/config/src/index.mjs`, with negative and graph tests. It defines valid source assembly, not implementation of every capability.

## Public interface

`validateBlueprint(manifest)` checks strict JSON shape, unique IDs, declared dependencies/cycles, safe relative source paths and nonoverlapping/case-distinct output mappings. It returns a clone; it does not inspect filesystem content. The assembler separately refuses symlinks, excluded artifacts, missing source and filesystem collisions.

`resolveModules(manifest, ids)` returns deterministic dependency-first module records. Selection is order-independent. `validateConfig(config, manifest)` validates unknown keys/types, a portable slug, display name, supported capabilities and required baseline closure; it returns a new normalized object without mutating input. Invalid values throw ConfigError with errors. No JSON value is evaluated as code or shell.

Initial config fields are schemaVersion1, id/name, modules, navigation.layout, theme.preset/tokens, auth.mode/providers/twoFactor, locale and extensions. `defaultConfig(id,name)` supplies an explicit public-synthetic baseline. The schema is extensible by versioned source/schema changes, not silently accepted unknown fields. Secrets do not belong in this JSON; unsupported/secret keys are rejected.

## Initial supported capability boundary

The first neutral release includes the required presentation/localization/navigation/records closure. Their first source distribution is composite: presentation includes the complete app-owned frontend; records includes the complete Python backend; localization/navigation declare required capabilities within that frontend, not separately downloadable services. Partial source selection cannot produce a frontend with missing backend/components. Later modular splits require explicit manifest/source tests.

Navigation supports sidebar/top/combined; themes linen/midnight plus validated semantic overrides. Colors are hex values, radius is bounded and font family is a conservative string, not a URL or script. Complete component/layout replacement is trusted child-owned source through a registry, not arbitrary executable JSON. Full English source/copy belongs to each generated app.

Auth schema names the target modes/providers for future implemented versions, but the initial manifest supports only mode none, no providers and no twoFactor. Requests for password/TOTP/social/identity modules fail before generation. Nonempty extension assembly also fails until implemented. Never generate a fake successful login or silently strip an unsupported requested feature. The public-development/synthetic/no-auth label is mandatory in the initial starter and does not close authentication/production-release tickets.

## Source and extension ownership

Each manifest source entry is `{from,to}` relative to the blueprint/generated roots. Absolute paths, traversal, backslashes, drive paths, reserved device names, empty/dot segments and output overlaps fail. The CLI includes only selected declared source closure and an explicit set of its own root assets/control files. It does not accept arbitrary network templates or read another seller checkout.

Foundation modules may depend only on other foundation interfaces; domain business policy belongs to app-owned modules. The first records API is a synthetic domain example, not inherited Field/Clinic/Care business logic. Future extension contracts use stable module IDs, child-owned source, explicit dependencies/routes/schema/migrations and separate policy services. A safe path declaration does not itself implement a plugin or authorize execution. The existing app portfolio is not modified by generation.

## Agreed first frontend/backend contract

- Backend: loopback Python/SQLite, `API_PORT` and `DATABASE_PATH` overrides, additive checksum migrations, no reset. GET `/api/health` identifies public-synthetic; GET `/api/records` returns records; POST accepts title/details; PATCH `/api/records/:id` accepts status todo/done and expected_revision, stale409.
- Records: stable integer ID, title≤200, details≤2000, status, revision starting1 and incrementing, UTC timestamps. Error codes are stable and translated by the frontend. Bodies/fields/transitions are validated; no identity or production access claim.
- Frontend: generated root app.config.json loaded through an app-local adapter; same-origin Next bridge uses server-only FORMA_BACKEND_URL, rejects foreign-origin writes and forwards only bounded supported requests. Default backend loopback config is explicit; no arbitrary client-provided target or secrets.
- Generated root launch/test/build scripts must be included and run outside both seller repos. Frontend component registry allows app-owned Shell/RecordForm/RecordCard replacement while preserving accessibility/form behavior.

## Evidence and next gate

Six config tests cover deterministic closure/nonmutation, all supported layouts/themes, unknown/unsafe/secret rejection, unsupported auth/extensions, missing baseline modules, invalid graphs/colliding source destinations and portable path rejection. Package install uses a workspace-local cache when the host default npm cache is unavailable. Registry publication and live provider tests have not been performed.

Saurya reviews this implementation before FORMA-0019 closes. The next generator/template work must prove installed tarball→fresh external source→install/build/start→persistent record flow and failure safety. Neutral proof is not permission to close the parent full authentication/consumer/release epics prematurely.
