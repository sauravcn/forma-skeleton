# Forma Skeleton working agreement

The owner selected sauravcn/forma-skeleton on 2026-10-25 as the canonical source repository for the reusable blueprint and app generator. This supersedes the earlier plan to author them inside forma-kernel-care-center. Existing business apps, Kernel commerce/licensing and current project tracker remain in that application repository. Do not duplicate issue status into a second backlog here.

Read README.md, TODO.md, HANDOFF.md, TRACKING.md and docs/architecture/standalone-contract.md before work. Inspect branch/tip/dirty state, fetch when available and preserve existing work. A repository handoff is not a live agent or an acknowledgment from a different chat.

## Team and authority

Saurav is VP of Engineering. Codex is Engineering Lead. Aarav, Saurya and Shreesh are user-chosen AI Senior Software Engineer role names for frontend/themes/navigation, backend/identity/security and generator/distribution/upgrades respectively. These are not representations of the named human relatives or permanently running services. Codex assigns numbered FORMA tickets, bounded file scopes and peer reviewers and integrates results. Same-task workers may message each other; no outbound channel to a separate local-development chat is verified. Avoid overlapping file writers across repos/clones.

The current issue authority is https://github.com/sauravcn/forma-kernel-care-center/blob/main/tracking/backlog.json and its generated board/coverage/team records. Canonical keys are FORMA-0001-style and globally shared across both repos. Never invent a separate skeleton numbering series or duplicate mutable ticket state. Old aliases/journals remain in the tracker repository. If tracker access is unavailable, preserve a concrete result/handoff and report that access gap; do not fabricate status synchronization.

## Source and delivery contracts

- Author future CLI under tools/create-forma-app, neutral versioned templates under blueprints/application, optional modules below that template root and consumer tests under tests/blueprint-consumers. These are planned implementation paths, not proof of working code.
- The generator package and required template/foundation source must be self-contained in this repo/distribution. Do not import private source from a sibling checkout, reach into the application monorepo during generation or require its Kernel/private registry at runtime.
- Generated customer projects include all required Forma source physically, plus ordinary third-party dependency manifests/notices; preserve domain-owned policies and stable IDs/localization. Full component/layout replacement and data-driven navigation must not weaken auth/accessibility.
- Maintain compatible auth/crypto through maintained libraries; password/2FA/provider integrations and Node-to-Python trust boundaries require actual tests, not UI flags or fake login. Schemas/modules unsupported by the selected version fail clearly.
- The seller's payment verification, license issuance/signing private keys and customer directory remain outside delivered children. Public verification keys/agreed license artifacts may be included. Source purchases are nonexclusive by default; copyright transfer/exclusivity are separately negotiated. Do not invent license grants or customer legal terms.
- No secrets, runtime databases, other customers' forks, dependency/build outputs or owner Google configuration in Git or generated bundles. Use synthetic fixtures; do not reset existing source/data to pass tests.
- Record exact blueprint/module versions, included source/dependency closure and provenance. Upgrades propose reviewed patches/conflicts and additive migrations; never silently overwrite customer changes or rewrite applied migrations.

## Completion and Git

Repository initialization delivered planning/handoff documents; FORMA-0019 now introduces executable configuration validation. The local generator and public-synthetic template have independent installed-package/browser verification; full authenticated generation remains unfinished. Do not claim executable generator, app template, new auth, hosting or production readiness from an empty directory/manifest. Tests must prove independent external install/build/run when code exists. API-provider setup and live acceptance are separate from mocks/adapters.

Use the assigned FORMA key in commits. Keep application source untouched during extraction/setup. Existing reviewed docs may initialize main; future substantive implementation uses scoped reviewed feature work. User-authorized commits/pushes are permitted; verify actual remote SHAs and report unpushed work. Do not force/rewrite history or publicly deploy/purchase resources from a ticket alone. Preserve existing remote content and never overwrite a concurrently initialized repo. Git backup covers tracked files only, not processes/secrets/runtime data.
