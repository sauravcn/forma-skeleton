# Standalone application source and module contract

Recorded 2026-10-25. Origin: the architecture artifact accepted under FORMA-0018 in forma-kernel-care-center main checkpoint 4351b5e. Destination revision: dedicated-repository routing selected by the owner; Shreesh authored this transfer for Codex/Aarav review. The shared canonical tracker records transfer status separately from the original accepted contract. No generator, blueprint template, generated app, new auth flow or deployment is implemented by this document. Paths below are reserved source locations to implement, not directories claimed to contain working code today.

## Repository and check-in decision

The owner selected **`sauravcn/forma-skeleton` as the canonical authoring repository** for the reusable scaffold, generator, module/template source and independent consumer harness. This explicitly supersedes the earlier same-repository authoring plan. Existing business applications, Kernel commerce/license issuance, current reusable app packages and the shared global FORMA tracker remain in `sauravcn/forma-kernel-care-center`.

Reviewed initialization documentation may establish this repository's main under the owner's instruction. Future implementation uses scoped feature work and reviewed integration here; do not assume an application-repo branch or commit automatically updates this repository. Source versioning is separate from deployment, customer delivery and central issue tracking.

| Source location | Responsibility | Delivery boundary |
| --- | --- | --- |
| `tools/create-forma-app/` | Future Node CLI, option/config validation, assembly plan, template-resolution and output safety | Developer tool; no requirement to run it in a deployed child app |
| `blueprints/application/` | Versioned neutral frontend/backend/foundation templates and module manifests | Selected source is copied into the child; no runtime reference back to this folder |
| `blueprints/application/modules/` | Versioned optional capability templates/contracts | Include selected required dependency closure only |
| `docs/architecture/` | Source/module/configuration and security-boundary decisions | Relevant documentation is included with generated source |
| `tests/blueprint-consumers/` | Future fresh-output, packaged-generator and upgrade fixtures/harness | Synthetic verification only; no production database/secret fixtures |
| `forma-kernel-care-center:apps/<existing-app>/` (other repository) | Existing Kernel/Care/Field/Accounting/Table/Clinic/Client app source | Remains there; preserve data/functions and adopt released skeleton changes explicitly |
| `forma-kernel-care-center:packages/` (other repository) | Current libraries used by existing applications | Extract approved required source into this repository at a recorded revision; never import a private sibling checkout during generator build or execution |

Do not put a partly implemented skeleton into the application repository's `apps/kernel` or turn Kernel into a runtime parent of each child. Do not rewrite existing apps merely to establish this source repository. A customer's generated output is a separate standalone directory/repository, independent of both seller repositories. Customer-specific forks/builds are isolated from other customers and from reusable authoring templates. Normal third-party dependency installation remains supported under their licenses.

The proposed authoring layout is:

```text
tools/create-forma-app/
  package.json
  bin/create-forma-app.mjs
  src/{config,plan,assemble,verify}/
  test/
blueprints/application/
  blueprint.json
  frontend/
  backend/
  foundation/frontend/{ui,localization,api-client,workspace-ui,auth}/
  foundation/python-sdk/
  modules/{identity,navigation,runtime-agents}/
  docs/
  deployment/
```

Each named directory is a contract location, not a requirement to create empty folders and claim completion. Domain templates can be added later under `blueprints/application/domains/<domain-id>/` after their app-specific licensing, source closure and test obligations are defined. The neutral starter is the first runnable target. The CLI/templates/harness paths are all local to forma-skeleton; no executable source was extracted merely by transferring this document.

## Extraction, pinning and independent authoring

Required source currently present only in the application repository must be extracted deliberately before a runnable blueprint release. This initialization transfers documentation only. The future extraction change must identify the exact upstream repository/commit and selected source paths, copy the complete transitive Forma source/export/CSS/assets/catalog/migration closure into `blueprints/application`, preserve required attribution/notices, neutralize seller-specific defaults and record file hashes/reviewed adaptations. No mutable branch lookup or unpinned remote download is allowed during normal generation.

A pinned developer-reviewed extraction may consume an approved source archive or explicitly supplied checkout as an authoring input. The resulting committed skeleton source and packaged generator must then build, test and generate with **only a forma-skeleton clone/distribution** plus normal declared third-party dependencies. They may not execute `../forma-kernel-care-center`, depend on its `node_modules`, read its runtime databases, import its private workspaces, or require access to that private repository at customer runtime. An upstream commit/path in provenance is an origin record, not an executable dependency.

Existing app-library source remains owned by its current repository until an explicit package/adoption decision. Blueprint-ready copies here are independently versioned release snapshots with recorded origin/adaptations; do not pretend two edited copies synchronize automatically. Define where future reusable-library changes originate and how they are reviewed/imported before publishing a release. Customer apps adopt approved versioned changes through the upgrade mechanism, never an implicit live cross-repository link.

The future `blueprint.lock.json` and source inventory include source-origin and adaptation provenance. A standalone generator verification job must hide/remove the sibling application checkout entirely. It must fail if the CLI/template closure contains a required outside-root import/symlink, seller Kernel dependency or private Forma registry lookup. These are acceptance requirements, not checks already performed on executable code in this documentation-only repository.

## Generated child layout

```text
<child-app>/
  package.json                  # App-local npm workspaces and root commands
  package-lock.json
  app.config.json
  blueprint.lock.json           # Exact template/module/source provenance
  frontend/                     # Next.js app and child-owned domain views
  backend/                      # Python app, domain services and SQL migrations
  foundation/
    frontend/{ui,localization,api-client,workspace-ui,auth}/
    python-sdk/                 # Included required Python SDK source
  theme/                        # Child-owned tokens, assets, components and layouts
  navigation/                   # Manifest and optional child-owned renderers
  modules/                      # Child capability/domain extensions and contracts
  migrations/identity/          # Child identity migration source, if selected
  tests/{backend,frontend,consumer}/
  docs/{setup,architecture,customization,operations}/
  deployment/                   # Selected example configuration, not a running service
  LICENSE                      # Agreed readable customer license when delivered
  THIRD_PARTY_NOTICES
  SOURCE_MANIFEST.json
  .env.example
  .gitignore
```

A free development-generation example has no purchase entitlement merely because it generated successfully. A licensed purchase may add its signed customer license artifact through seller fulfillment; the developer CLI must not fabricate proof of purchase. Exact contract language, update/support duration and bespoke IP rights remain separate owner/legal decisions.

Use app-local npm workspaces within the generated repository to preserve maintainable module boundaries while delivering their complete source. Prefer an app-specific package scope such as `@sample-desk/ui`; generated imports and explicit subpath/CSS exports resolve only inside that child or normal declared third-party packages. This is copied source under the applicable customer license, not a transfer of Forma copyright or a required external shared Forma component service. The included Python SDK can preserve the `forma_sdk` import namespace for compatibility, but its install/build source and dependency resolution must be local to the child. No private-index availability or original root path is assumed.

## Dependency and source-ownership rules

1. Child domain frontend may consume its local foundation presentation/transport/localization interfaces; child backend may consume its local SDK/contracts. Foundation cannot import child domain policies. Extensions call documented hooks/services; app-specific money/clinical/service policies remain domain-owned.
2. The CLI reads versioned blueprint manifests and copies their selected transitive source closure. A module declares required local source, subpath exports, CSS/assets, migrations, tests and third-party requirements; it cannot rely on a symlink outside the generated root.
3. Generated source cannot import seller Kernel catalog, merchant checkout, seller account/entitlement database, source-delivery service, another app's source or another customer's fork. No kernel route, absolute cloud path or developer `PYTHONPATH` is a hidden normal-runtime dependency.
4. Bundle ordinary manifests/locks and required notices for maintained libraries. Include required Forma source physically, rather than only a compiled binary or an inaccessible private package version. Preserve third-party rights; a source purchase does not transfer third-party copyright.
5. Exclude seller signing private keys, provider/API tokens, owner Google configuration, real customer records, mutable databases, generated dependency/build folders and unrelated products. Public verification keys and the buyer's agreed license metadata may be delivered; seller issuance/payment verification remains seller-side.
6. Generate environment schema/examples and safe configuration instructions. New deployments create their own secrets/databases. The CLI must neither request the owner's local secret/database nor copy it into output. Synthetic demo seeding must be explicit and never reset an existing database.

## Manifest and provenance specification

`blueprint.json` describes a released template version, compatible CLI/schema versions, module inventory, supported option combinations, required source/export/assets, normal third-party dependencies, environment variable names and validation commands. Modules use stable identifiers independent of labels or themes. Invalid/cyclic dependencies, path traversal, unknown options and unsupported combinations fail before output is committed.

The following is an illustrative shape to formalize in FORMA-0019; version values are planned examples, not published artifacts:

```json
{
  "schemaVersion": 1,
  "id": "forma.application",
  "version": "0.1.0",
  "compatibleGenerator": "0.1.x",
  "modules": [
    {
      "id": "navigation",
      "version": "0.1.0",
      "requires": ["presentation", "localization"],
      "source": [{"from": "modules/navigation", "to": "navigation"}],
      "capabilities": ["sidebar", "top", "combined", "mobile"]
    }
  ]
}
```

`app.config.json` owns stable app ID, display-name translation key, selected modules, route/nav manifest binding, layout renderer choice, theme/component bindings, locale configuration and permitted environment-name bindings. Authentication provider selection and runtime-agent features are explicit capabilities. A selection is valid only when implemented and tested in that blueprint version: unsupported password/2FA/social options fail clearly, rather than emitting a fake working button or a bypass. JSON data is not an arbitrary shell/script execution channel.

`blueprint.lock.json` records exact generator/template/module versions, original source revision, dependency inventory and generated-file baseline digests. `SOURCE_MANIFEST.json` inventories delivered source and notices with hashes. Applied migrations are versioned and checksum-protected. Provenance permits later three-way baseline/local/new comparison; it does not permit automatically overwriting a buyer's changes. Optional approved updates remain separate reviewable patches/migrations with conflict reporting, abort safety and documented recovery.

## Presentation and navigation interfaces

Aarav owns detailed presentation design under the follow-on tickets. This source contract requires the child to own both semantic theme tokens and complete replaceable auth/shell/component/layout bindings. Replacements may change DOM/layout while preserving documented keyboard/focus/error association and maintained-library submission behavior. No default Kernel logo, storefront wording or illustrative monthly/license prices should leak through theme/localization fallback. Explicit CSS and package subpath exports are part of the required source closure.

Navigation is declarative stable route IDs, label keys, icon bindings, group/order, visibility permission requirements and feature flags. App config selects sidebar/top/combined/mobile renderers, and the child may replace those renderers. Visibility rules never authorize direct backend operations. Full English catalog and app-specific messages ship locally; locale formatting, stable API enums and routes remain independent of translated text. Two substantially different themes and long-text/RTL/keyboard/mobile verification are later acceptance requirements, not claims about this document.

## Identity and API boundary

Retain the current technology direction: Next.js/React presentation, Python domain APIs and maintained authentication-library integration. Include child-required auth adapter/source/migrations instead of borrowing Kernel sessions. PostgreSQL identity and a domain database are separate responsibilities; this contract does not migrate Kernel PostgreSQL, Care SQLite or existing app data.

The maintained Node auth integration with same-origin frontend routes is the working design candidate. How Python verifies that child's identity—maintained session introspection or a maintained audience-bound verification mechanism—must be decided and threat-tested in FORMA-0038/FORMA-0039. This is unresolved, and must be settled before claiming generated human-authenticated APIs. Do not substitute client-supplied identity/role headers, a custom token protocol or an unprotected private-looking endpoint.

The logical auth view contract includes configured providers, signed-out/challenge-required/signed-in state, server-confirmed permissions, reauthentication requirements and stable error/translation codes. The server owns challenge binding/expiry, sessions, roles, revocation and protected API authorization. This is a proposed behavior contract, not a claim that the endpoints/password/TOTP/provider flows already exist. Runtime business-agent credentials/scopes remain distinct from customer sessions and development-time coding-agent access. Required module source may ship locally; actual configured keys never ship.

## CLI build and distribution

Start with a source-controlled local CLI under this repository's `tools/create-forma-app`; its build packages a pinned copy of this repository's selected `blueprints/application` release into the CLI distribution. The CLI build itself and the packaged executable resolve required source from forma-skeleton/their own distribution, never a private sibling repository or an unpinned network download. Test the packed tarball in a clean consumer before any registry release.

A future npm package named `create-forma-app` would support the requested `npx create-forma-app` experience if name availability and publishing rights are secured. Local tarball installation is the first verification path; private or public npm publication is a separate authorized release decision. Customers do not require CLI/registry access to run source already delivered. Do not claim that the command is currently published or usable.

Generation stages: validate inputs/capability matrix → resolve source closure → produce a reviewable assembly plan → write to an isolated staging directory → verify expected source/manifests → atomically place a new output directory. Refuse an existing destination and unsafe paths. A failure cannot leave an existing app partially overwritten. Generation and later upgrade are separate commands/workflows; neither changes the existing application collection or a real database as a side effect.

## Next runnable acceptance: minimal standalone example

FORMA-0019 formalizes config/schema/extensions. FORMA-0021/FORMA-0022/FORMA-0024 implement the first generator and source assembly. FORMA-0026/FORMA-0027 verify it. The next bounded proof is a neutral synthetic starter generated from the packed local CLI into a fresh directory outside both seller repositories:

1. Install ordinary third-party dependencies plus included app-local source without a private Forma registry, seller Kernel, either seller checkout, or imports/symlinks outside the generated root.
2. Build frontend and Python distribution, initialize a new isolated synthetic domain database, start independent processes and exercise a rendered neutral shell/navigation plus an HTTP-backed synthetic record flow. Restart preserves synthetic data; regeneration refuses the existing output.
3. Verify manifest/module/source hashes, package exports/CSS/catalog closure, no inherited Kernel pricing/branding and no excluded secrets/data/unrelated code. Run generation twice into separate clean directories with equivalent selected versions and compare reproducible source inventory, excluding expressly documented generated metadata.
4. For selected implemented identity modules, migrate their disposable identity store and prove direct API denial for missing/forged/expired/revoked identity, wrong-instance audience and forged roles, plus the configured maintained-library login/challenge flow. If identity is not implemented in the first minimal proof, omit that capability and label the starter a public synthetic development example; this cannot close password/2FA/provider/authentication or full-release tickets. Never emit a pretend authenticated app.
5. Verify failure safety for unsupported module/provider choices, invalid names/path traversal, missing template closure and existing destinations. State actual test results and remaining modules rather than treating a successful directory copy as a complete blueprint.

This milestone proves generator/source portability only to its verified scope. Full owner requirements additionally need password/2FA/recovery, each social-provider adapter and separate real sign-in acceptance, safe upgrades, guided AI customization, per-purchase licensing/Kernel fulfillment and managed-hosting operational acceptance. Those remain separately tracked.

## Existing app adoption and customer handoff

Existing business apps remain in forma-kernel-care-center. Adopt released skeleton source first with Field Service, then the distinct Clinic Desk theme under the pilot tickets; subsequent Accounting, Table, Client and Care adoption is staged and separately verified across the repository boundary. Preserve existing workflows, stable IDs, independent build/API ownership and data. No mass reorganization or database replacement is part of FORMA-0018.

Self-managed source and Forma-managed hosting use the same independently runnable source boundary with distinct delivery/operations entitlements. Seller license issuance/signing and customer private code stay isolated. Source-copy rights follow the approved nonexclusive customer license; copyright assignment/exclusivity remain separate negotiations. A private internal engineering tracker is not part of the customer app dependency closure.

## Review and evidence for this contract

This destination revision answers where skeleton source will be checked in and specifies cross-repository source/module/dependency/provenance boundaries and the next runnable proof. The earlier reviewed same-repository routing is historical and superseded by the owner's dedicated forma-skeleton selection. No future directory tree was populated with executable skeleton code during this task. The original FORMA-0018 record contains actual Aarav frontend override/navigation/export feedback, including exclusion of Kernel pricing defaults, and Saurya feedback on child-owned auth/config/migrations, maintained audience/expiry/revocation validation, existing PostgreSQL/SQLite preservation and seller signing/purchase exclusion. Those original replies inform the retained contract; they do not constitute review of this dedicated-repository revision or establish a working generated authentication system. Codex accepted the original architecture artifact for FORMA-0018 in the application repository; that does not pre-approve this destination revision. Codex/Aarav review the dedicated-source routing before its initialization checkpoint. Executable implementation remains separately ticketed in the shared tracker linked from TRACKING.md; this repository must not create another mutable issue-status copy.
