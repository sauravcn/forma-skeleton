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
