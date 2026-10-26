# Working on this generated application

This is complete app-local source for a public synthetic development starter. Authentication, production tenancy, live AI, payments, license issuance, managed hosting and automatic upgrades are not implemented. No coding agent is automatically installed or running. Use your own approved developer assistant and review its diffs; this guidance is not a promise that any prompt produces a correct product.

Before edits, read README.md, app.config.json, blueprint.lock.json, SOURCE_MANIFEST.json and contracts/records.openapi.json. Inspect Git/dirty state and preserve other work. Never copy owner/customer secrets, runtime databases or another customer's code into prompts, source control or fixtures. Provider access, paid actions, deployment and source-use rights follow the applicable operator agreement; generation itself grants no purchase entitlement.

## Source map

- frontend/src/components/registry.jsx owns replaceable Shell, RecordForm and RecordCard source. Preserve accessible names, keyboard/focus behavior, actual pending/error state and the public-synthetic disclosure. Full structure may be replaced; no private Forma package is required.
- app.config.json selects app identity, linen/midnight theme and sidebar/top/combined navigation. Source theme/CSS is app-owned; currently accepted JSON tokens are limited. Validate options with the generator before first generation; source edits still need review/build.
- frontend/src/navigation.manifest.json and navigation.schema.json define stable data-only routes, labels, groups/order, hierarchy and optional visibility metadata. navigation.js validates bindings/paths/cycles. JSON cannot execute code. Hiding a link never authorizes an API.
- frontend/src/messages/en.json owns starter interface text. Keep stable route/API/status IDs separate from labels; use the local i18n date/number helpers. Customer-entered records remain data. Only en-US is currently supported; do not claim RTL/localization acceptance without rendered tests.
- backend/starter_api owns the synthetic domain API and SQLite repository. contracts/records.openapi.json describes its current public API, not an authenticated agent API. The frontend bridge uses fixed loopback transport and stable error codes.
- backend/starter_api/migrations contains additive checksum-verified SQL. Never edit/remove applied migrations, reset an existing database, invent successful writes or silently overwrite customized source. DATABASE_PATH points to an isolated ignored runtime file.

## Development and review

Node 22+, npm and Python 3.11+ are required. Run npm ci, npm test and npm run build from this project root. npm start runs both services; npm run dev enables the frontend development server. Consult README and .env.example for explicit exported WEB_PORT/API_PORT/DATABASE_PATH/PYTHON_BIN values. The launcher does not automatically load .env. Stop with Ctrl+C. Use new synthetic data and unused loopback ports.

For a requested field or workflow change, inspect the controller, API request/response contract, domain service, additive migration, English messages and relevant tests together. Keep the backend authoritative, unknown fields rejected and expected_revision conflict checks intact. Review failures, stale writes and restart persistence; inspect the actual rendered desktop/mobile result. A changed label must not change IDs or API enum values. Update API contract/tests when behavior changes.

Use small reviewable commits and report exact commands/results, limitations and backup status. SOURCE_MANIFEST/blueprint.lock describe the generated baseline: do not regenerate a customized app or rewrite its baseline to conceal changes. Later blueprint upgrades require a separate reviewed proposal; no automatic upgrade command is shipped.

Coding-assistant prompts may request a reviewed theme/layout change or a synthetic field/workflow extension. They do not grant the assistant unrestricted filesystem/network access or authorize external transmission of confidential code/data. A nontechnical prompt-to-preview service and runtime business-agent credentials are separate unfinished products.
