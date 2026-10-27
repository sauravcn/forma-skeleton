# create-forma-app

Source-controlled local CLI with a default public-synthetic profile and an authenticated password+mandatory-TOTP integration profile. This package is private and **not published to npm**. Its packed distribution includes a source snapshot of the config validator, schemas and selected blueprint; it never downloads a network template or reads a sibling seller checkout while generating.

From the skeleton authoring checkout:

```sh
npm install
node tools/create-forma-app/scripts/build.mjs
node tools/create-forma-app/bin/create-forma-app.mjs /tmp/my-demo --yes --id my-demo --name 'My Demo' --navigation sidebar --theme linen
npm pack ./tools/create-forma-app --pack-destination /tmp
```

The CLI package declares pinned AJV 8.20.0 as an ordinary dependency. Install the packed tarball in a clean temporary npm consumer to use its `create-forma-app` bin. A future public `npx create-forma-app` experience requires an authorized registry release and name availability; package creation is not publication.

Supported options: destination, `--id`, `--name`, `--navigation sidebar|top|combined`, `--theme linen|midnight`, `--profile public|password-totp`, `--config path.json`, `--yes`, `--dry-run`, `--help`, `--version`. Interactive prompts and explicit/default noninteractive config use the same final validator. Non-TTY scripts must pass --yes or --config; config input must follow the strict app schema. Unsupported authentication/extensions fail without output. No credentials, database copy, installed dependencies or paid resources are requested during generation.

The source inventory records actual content hashes plus Git revision/dirty state when available; a development snapshot is not misrepresented as a clean released commit. Generated source includes root install/build/test/start instructions and launcher; normal frontend dependency installation is explicit, not hidden behind generation.

Safety: only manifest-declared selected source and fixed CLI root assets are copied. Missing source, symlinks, excluded private/runtime files, output collisions, unsafe paths and existing destinations fail. Staging precedes an exclusive destination reservation. Portable Node APIs do not provide a whole-directory rename-with-no-replace guarantee, so output is explicitly pending until the completion marker is written and the pending marker removed. Interrupted output is retained for inspection, never silently overwritten on retry. Same-output races cannot replace another generator's directory. This is local developer-tool safety, not a hostile multi-user filesystem sandbox.

Tests: `node --test tools/create-forma-app/test/*.test.mjs` after bundling; tests create isolated fixture bundles/output paths and do not mutate existing apps/databases. Full packed-consumer install/build/API/browser/restart checks are separately run by the integration harness. Generation does not close authentication, guided AI, licensing, hosting or upgrade requirements.

## Maintainer lock updates

`assets/starter-lock.json` is the reviewed root lock fixture for the exact frontend dependencies; generation changes only root/workspace identity fields as structured JSON and records the resulting hash. `_gitignore` and `starter-lock.json` use nonreserved asset names so npm packing cannot silently omit a `.gitignore` or package-root lockfile. The delivered filenames are `.gitignore` and `package-lock.json`.

When frontend dependencies change, explicitly refresh a disposable `sample-app` fixture with the generated root/frontend manifests, run `npm install --package-lock-only --ignore-scripts` using the approved registry/cache, review the dependency/license/audit diff, then update `assets/starter-lock.json` and rerun packed-consumer `npm ci`. Do not silently resolve new dependencies during generation. A mismatched fixture fails before output. The current consumer/startup verification targets macOS/Linux-style process supervision; Windows process-tree cleanup has not been accepted.

## Authenticated integration profile

Use `--profile password-totp` (or config auth mode `password`, providers `[]`, twoFactor `true`). The validator resolves identity and records-auth module closure; password-only/social combinations and public/auth-module mixtures fail. No credentials are requested by generation. Runtime startup and explicit fresh-store migration require the child identity README configuration; live SMTP/provider/production acceptance is separate.

Prepack copies canonical lifecycle, boundary Python, presentation and original record SQL physically into the versioned snapshot. Provenance records original same-repository paths plus revision/dirty/content hashes; no sibling source or private runtime dependency remains. Fixed public/auth selectors are source assets, never executable JSON interpolation. Authenticated frontend adds pinned local `qrcode`; identity uses pinned Better Auth, pg, utils and Nodemailer. `authenticated-lock.json` is a separate reviewed lock fixture. Profile-specific package dependency mismatch refuses output. No dependencies resolve during generation.

The authenticated profile is under active integration; do not infer installed-package/browser acceptance from successful config or assembly tests. Public regression and authenticated external-consumer proofs are separate gates.

### Registered business-app templates (optional distribution catalog)

A catalog-enabled package supports the conventional command:

```sh
npx create-forma-app my-care-center --template care-center --yes
```

Other template names are `field-service`, `accounting-studio`, `table-kitchen`,
`clinic-desk` and `client-studio`. The destination is your directory name; each
app retains its stable ID, existing base path, custom theme and business source.
These templates require the password + mandatory TOTP/recovery profile and
operator-configured PostgreSQL, SMTP, secrets and membership approval. Follow
the generated README and ENVIRONMENT.example; generation does not configure or
start those services. `--id`, `--name`, `--theme`, `--navigation`, `--config` and
`--profile` are neutral-starter options and are rejected with `--template`.
Customize the copied app-owned source after generation. `--dry-run` validates
and lists the selected template without writing a destination.

Omitting `--template` preserves the neutral starter, its configuration prompts
and existing profiles. A package built without the optional catalog reports a
clear unsupported-template error rather than fetching private source.

Maintainers prepare reviewed complete app exports in an explicit catalog with
one directory per template plus `catalog.json` with `{schemaVersion:1,apps:["app-id",...]}`. Advertised IDs are validated; no fixed six-app list is built into the generator. Then build or pack with that input:

```sh
node tools/create-forma-app/scripts/build.mjs --catalog-dir /reviewed/catalog
FORMA_TEMPLATE_CATALOG_DIR=/reviewed/catalog npm pack --workspace tools/create-forma-app
```

The environment variable is required for `npm pack` because its prepack hook
rebuilds the bundle. No catalog is inferred from sibling checkout locations.
The build validates all advertised inventories, hashes, fixed profiles and completion
markers, refuses pending catalogs/symlinks/private runtime artifacts, and copies
the exports into self-contained path/base64 JSON payloads in the package. This
preserves exact source bytes, including `.gitignore` and lockfiles, through npm
packing rules. Generation validates and decodes those payloads into ordinary
customer-owned files; it uses bundled bytes only,
without network access or either seller repository. Existing export manifests,
source provenance, third-party notices and customer AGENTS instructions remain
included. These hashes provide integrity checks, not a signed license grant or
supplier-authenticity guarantee. No public npm publication is performed by this
workflow; the package can be installed/tested from its tarball first.

### Generate a new authoring workspace from the backbone

```sh
node tools/create-forma-app/bin/create-forma-app.mjs /repo/apps/new-app --workspace-domain /reviewed/definition.json --yes
```

This mode is distinct from a complete standalone customer project. It creates a
new app directory only, refuses existing destinations, and never edits the
parent registry, package manifest, lock or shared English catalog. A maintainer
reviews `registration.proposal.json` and `localization.proposal.json` before
integrating them into the authoring repository. Required shared library source
must already be available there; customer delivery subsequently uses the
application exporter to copy the full selected dependency closure.

Definition version1 fields are `schemaVersion`, `id`, `name`, `nameKey`,
`pythonModule` (`forma_` plus the underscore-separated ID), distinct integer
`webPort`/`apiPort`, `navigationLayout`, `theme:{name,tokens}`,
`navigation:[{id,labelKey,icon}]` and `labels:{EnglishKey:wholeMessage}`.
Stable IDs/paths/module names, English bindings, theme values and navigation are
validated. Version0.1 registers the `layers` navigation icon; extend the app-owned bindings and UI source for domain-specific icons. The versioned `blueprints/domain-workspace` source is pinned in the
package snapshot; generation records blueprint/input/source/output hashes in
`WORKSPACE_BLUEPRINT.json`. Parent directories and runtime databases are not
modified. Identical input produces identical source bytes.

The generated app has maintained foundation/identity/API wiring and an app-owned
layout, theme, navigation and Python package. Its domain is explicitly unfinished:
authorization fails closed with503 and the domain mutation stub returns501 until implemented. Keep `001_foundation.sql` immutable and
add domain migrations from002 onward. Domain workflows, role policy, tests,
independent builds and real browser acceptance must be supplied before claiming
a functional product. This scaffold does not clone another business app or grant
live AI/provider/payment/production capabilities.
