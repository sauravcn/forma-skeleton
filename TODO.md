## Implementation started — owner-authorized peer review and main checkpoints

FORMA-0019 now includes executable strict JSON schemas, deterministic module/capability validation and unsafe-path/field rejection. Six focused tests pass with pinned AJV8.20.0; production dependency audit reports zero current advisories. Saurya reviewed actual source and approved configuration-contract scope. No runnable generator/auth feature is claimed yet. The next assigned team milestone is complete CLI/template assembly and an external neutral public-synthetic app proof. Existing apps/owner data remain untouched.

# Repository-local decisions and next step

Recorded 2026-10-25. Live ticket status remains in the canonical shared FORMA tracker linked from TRACKING.md; this file records repository decisions, not another board.

The owner selected this dedicated skeleton repo. Initial source contracts and developer handoff were initialized as reviewed documentation; existing business applications/data are retained in forma-kernel-care-center. No executable generator or template implementation has been transferred or created by this initialization.

Next bounded source task is FORMA-0019: finalize configuration/module/extension schema after the source/module contract. Generation/assembly, full parent-controlled presentation, password/2FA/social identity, independent consumer proof and safe upgrades remain separately ticketed. Before implementing, Codex assigns current scope and peer review and reconciles both repos' latest source/tracker states.

Future source paths: tools/create-forma-app, blueprints/application and tests/blueprint-consumers. A neutral runnable example must install/build/start outside both seller repos with complete required source; no private sibling checkout or seller Kernel dependency. Do not populate empty directories and label the scaffold finished.

Customer-specific code/data, seller signing secrets, payment-provider keys and runtime database backups are outside this repo. Actual operational hosting and the shared issue-tracker service are separate projects/decisions, not delivered by repository creation.
