# Repository decisions and next steps

Recorded 2026-10-26. Canonical ticket state is in the shared tracker linked from TRACKING.md.

The dedicated forma-skeleton repository owns the generator and copied-source blueprint. Existing business apps and the sole FORMA tracker remain in forma-kernel-care-center. Owner authorized scoped implementation, peer review, tested main promotion and backups.

Configuration validation (FORMA-0019) is merged at 01c971a. Generator/frontend/backend implementation is merged on main at27d2696 and retained on feature/forma-0016-generator. Its initial supported output is explicitly public synthetic/no-auth, with all required source included. No secrets or runtime data are transferred.

Next gates: installed npm-command generation, clean external npm ci/tests/build/start/restart, six actual browser theme/navigation variants, full shell source replacement and peer approval. Record exact final verification in HANDOFF before promotion. FORMA-0016 and full authenticated-consumer scope remain open even after this neutral milestone.

Follow-on work: maintained-library identity boundary, password/TOTP/recovery/provider adapters; full presentation/accessibility/localization contract; safe upgrade proposals; AI customization; per-purchase licensing and hosting. Unsupported capabilities must fail honestly. No paid infrastructure, registry publication or production deployment is authorized by a coding ticket alone.

Follow-on source work: navigation manifest0034 is reviewed/merged; renderer keyboard acceptance0035 is reviewed and verified. Reviewed developer-agent guidance/OpenAPI delivery0064 and non-shipped basic-session identity0039 proof follow; actual generated authentication/password/TOTP/providers remain unfinished. Never treat fixture tests as their acceptance.


## Active generated identity integration — 2026-10-26

Owner reaffirmed peer review, tested main merges and board updates; no new repository is needed. Reviewed skeleton main is2721fc1 (semantic parent themes), with recovery enrollment hardening ece07c4 included. Presentation0029/0177 is Done; generated authenticated release0176 remains In Progress, not enabled yet. Assigned0178 Saurya runtime/domain protection,0179 Aarav actual UI/controller,0180 Shreesh generator/source closure; Codex owns cross-profile external browser acceptance and integration. Read skeleton docs/architecture/generated-identity-integration.md for exact shared interfaces. Public none profile must preserve behavior. No live mail/OAuth/production or uninterrupted overnight guarantee. Local must fetch/read latest board/source and obtain scope reconciliation before overlapping edits.


## Feature recovery checkpoint and PR workflow — October 26, 2026 (client date)

The owner asked why agent PR history is absent. Prior reviewed checkpoints used direct main pushes. gh reports its token invalid and GitHub API returns Forbidden; Git transport works separately. Read docs/engineering/PULL_REQUEST_WORKFLOW.md. Keep new integration on the existing feature branch until PR workflow/access is resolved; no historical PR/native approval is invented.

A brief execution transport outage recovered with edits retained. This is an IN-PROGRESS recovery checkpoint, not completed release acceptance. Actual installed authenticated consumer passed npm ci/test/build, explicit synthetic PostgreSQL/SQLite migration, registration/private mail verification/password/TOTP/recovery/reset/logout, two-user ownership denial and persistence (.run/authenticated-consumer/report.json complete true). Root also passed two fresh PostgreSQL store counterexamples after view adoption was fixed and five domain tests. Subsequent visual polish/security refinements still require final reruns and peer review. No live SMTP/OAuth/production claim; ignored runtime data/secrets/processes are not Git backups. Next: complete current reviews/security regressions, rerun latest actual browser/UI, update tickets honestly, then create actual agent/integration PRs when API access works.


## Latest verified integration and PR diagnosis — October 26, 2026 (client date)

Latest actual independent authenticated consumer passed again after theme/notice/security refinements: installed CLI/source closure, npm ci/test/build, fresh migrations, browser verification/password/TOTP/recovery/reset/logout/two-user authorization, desktop/mobile login and output-secret audit. Real screenshots under docs/screenshots/authenticated-*.png have no enrollment secrets. Lead independently passed npm test (8 config +12 CLI +18 frontend +13 public backend),36 maintained lifecycle/security/migration checks,9 original boundary checks,3 configuration/mail/native-transport checks,6 domain checks and2 PG-store counterexamples. Aarav performed final read-only backend/security source review and found no new blocker for this exact local synthetic profile; independent native GitHub approvals/production/live delivery are not claimed.

Correction to the earlier credential diagnosis: curl to api.github.com fails before GitHub, at proxy CONNECT with403 Envoy. gh invalid-token warning is inconclusive; do not request a replacement token yet. Existing package-manager preset omits api.github.com. The onboarding draft successfully adds only that domain, preserving five custom research destinations and all presets; requires_publish=true. Owner reviews/saves and publishes environment settings, then retry existing API authentication/PR access. Source work and Git backup are separate from this publication. New main integration remains held for actual PR workflow.


## GitHub API restored and native PR delivery

Owner publication activated api.github.com: API200 and existing admin/push rights verified for both repos; no replacement token required. Actual skeleton PRs #1 [Saurya], #2 [Aarav], #3 [Shreesh] carry scoped commits and attributed review findings; they target temporary review/forma-0176-identity, never broken intermediate main. The preserved feature backup remains untouched by review-history reconstruction; no force/history rewrite. Codex QA peer review by Aarav caught unawaited process/log cleanup and possible parent Playwright error leakage; fixed with observed stdio close, awaited TERM/KILL/allSettled cleanup, port closure checks, whitelisted error reporting and individual cookie auditing. Four subprocess/redaction counterexamples passed; full actual generated browser acceptance passed again after cleanup/secret audit. Codex QA PR and final integration PR must be verified as actually merged before claiming main delivery. Six existing business-app adoptions remain Backlog and are not implied by this milestone.


## Six-app npx convention — October26, 2026

FORMA-0190 extends existing create-forma-app with --template field-service|accounting-studio|table-kitchen|clinic-desk|client-studio|care-center. Authoring source remains in application repo; maintainer explicitly imports a reviewed exported catalog at packaging time. Package/runtime contains source snapshots and needs no sibling checkout. Neutral no-template behavior retained; app destination naming preserves stable IDs/base paths and mandatory password/TOTP policy. No public registry publication or license issuance.

Actual npm pack omissions discovered by independent191 led to one bounded serialized source payload perapp; every decoded file/path/hash still validates before output. Worker18 CLI checks include actual packed/install npm-special file regression; lead full npmtest independently passed. Six real domain packed npx install/test/build verification is tracked191; see applicationrepo docs/engineering/CREATE_APP_COMMAND.md for exact build and local archive commands.

Final191 lead acceptance now passed: all SIX real-source offline packed npx generation, exact catalog bytes/file inventory, independent npm ci/test/build and awaited cleanup. Apprepo committed acceptance summary and command guide hold details; no public registry publication. Final190 serialized source peer approved by Aarav, including independently passing actual packed synthetic regression.


Active192 mocked social:193 canonical maintainedfiveprovider + setpassword/MFA safeguards,194 themedmockcontrols wired; code peerapproved. Lifecycle38 tests pass inclreal isolatedPG callback/code/PKCE/replay/collision/MFA, production/dev-serving refusals. Root196 all6browser/normal-launch/packedconsumer proof still pending before source integration. Explicit mock simulation is not live provider acceptance. Feature checkpoint only, no newmain or npm publication.


Final192 mocked integration acceptance: canonical installedpackedCLI realbrowser with deliveredprivateCLI admission and all5cancel/Google/password/TOTP/records/returnfactor/recovery/logout passed, secrets/ports/ownresources cleaned. Allsixdomain browser/fullbusiness and normalprotectedlauncher persistence also passed in apprepo. Source193+194 and QA196 peerapproved; preparing nativecomponent PRs then fullmainmerge. Live external providers and0016commercial scope remain open. No publicnpm/paidservice/deployment. Generated README now includes explicitdevmock flags and verified --approve-member --email admission, preserving defaultadminbootstrap behavior.


## VERIFIED mock main delivery — October26, 2026

Canonical source agent PR7Saurya/8Aarav/9Codex and complete [PR10](https://github.com/sauravcn/forma-skeleton/pull/10) are MERGED. Fetched skeletonmain21b6aeb1789898c2af2ceeb1935f7dd78c4b7c9a entiretree exactly matches accepted source. App complete [PR15](https://github.com/sauravcn/forma-kernel-care-center/pull/15) also MERGED/verified5684c4b. Later notes-only commits may follow; fetch currentmain without resetting history. Earlier pendingmerge notes are superseded.

Canonical packedgenerated realMOCK browser/deliveredoperator/password/TOTP/records/returnfactor/recovery/logout, all6domainfullbrowser, normal6protectedlauncher persistentrestart and final6npx/ci/test/build all passed. Root canonical/source UI/PG/policy proofs peerapproved; screenshots/acceptance summary committed in apprepo. For normal six-app local review, use app LOCAL_RESUME.md and docs/engineering/LOCAL_MOCK_IDENTITY.md with python3 run.py start --mock-social. For neutral starter select --profile password-totp, configure ownstores/mail then optionallocalmockruntime; delivered README has explicit verified --approve-member --email command. Never use ownerDBs toexperiment.

Overall0016 and realexternalprovider/commercial/production scope remainopen; mocked192–196 accepted. No publicnpm/paidservice/deployment. Recoveryfeaturehistory preserved by ordinarymainmerge; trackedsource/notes backedup, ignoredruntimedata/processes notbackups. Sourcework paused after this completedscope; localagent must reconcile beforenewedits.
