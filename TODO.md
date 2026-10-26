# Repository decisions and next steps

Recorded 2026-10-26. Canonical ticket state is in the shared tracker linked from TRACKING.md.

The dedicated forma-skeleton repository owns the generator and copied-source blueprint. Existing business apps and the sole FORMA tracker remain in forma-kernel-care-center. Owner authorized scoped implementation, peer review, tested main promotion and backups.

Configuration validation (FORMA-0019) is merged at 01c971a. Generator/frontend/backend implementation follows on the existing feature/forma-0016-generator branch. Its initial supported output is explicitly public synthetic/no-auth, with all required source included. No secrets or runtime data are transferred.

Next gates: installed npm-command generation, clean external npm ci/tests/build/start/restart, six actual browser theme/navigation variants, full shell source replacement and peer approval. Record exact final verification in HANDOFF before promotion. FORMA-0016 and full authenticated-consumer scope remain open even after this neutral milestone.

Follow-on work: maintained-library identity boundary, password/TOTP/recovery/provider adapters; full presentation/accessibility/localization contract; safe upgrade proposals; AI customization; per-purchase licensing and hosting. Unsupported capabilities must fail honestly. No paid infrastructure, registry publication or production deployment is authorized by a coding ticket alone.
