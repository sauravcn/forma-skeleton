# App-owned presentation and replacement contract

FORMA-0030. Recorded 2026-10-26. Owner: Aarav; peer reviewer: Saurya; integration owner: Codex. This contract describes the current neutral template and the requirements for later presentation/auth work. It does not claim full accessibility, RTL, authentication or arbitrary-theme acceptance.

## Ownership and implementation boundary

The selected frontend source is copied from `blueprints/application/frontend` into a generated customer's `frontend` directory. It uses that child's root `app.config.json` and local component/style/message source, not seller Kernel UI, a private Forma package service or a sibling checkout. The app owner may replace complete components and DOM/layout, not only recolor a fixed dashboard. Source editing remains trusted developer activity; JSON never evaluates a function, component import, HTML or script.

The current component registry is `frontend/src/components/registry.jsx`; `Starter.jsx` imports its Shell, RecordForm and RecordCard bindings. These are actual replaceable source components, not runtime plugins. Separate auth components, login/challenge controllers, server-authorized navigation policy, arbitrary domain extensions and complete semantic-token coverage remain follow-on work. This document closes a contract/design task, not those implementation stories.

## Configuration and semantic-theme precedence

1. The generator validates config against `schemas/app-config.schema.json` and the selected blueprint's supported capability matrix. Unknown config keys and unsupported capabilities fail before output; selected module/source closure is deterministic.
2. `frontend/src/config.js` imports `../../app.config.json`, within the generated project root. This is app-owned source configuration, not a remote parent or browser-supplied object.
3. `themeStyle` selects the `linen` or `midnight` preset, then shallow-merges `config.theme.tokens` over the selected preset without mutating it. An unknown preset fails. Radius becomes a pixel value; other values become `--app-<token>` custom properties.
4. `app/layout.jsx` sets those variables on the generated application's body. Component CSS consumes/inherits them; a deliberate app-owned descendant variable/style override may specialize its own subtree through ordinary CSS rules. There is no implemented nested ThemeProvider/context or multiple-isolated-theme-instance API.
5. Full replacement components may bring app-owned CSS/layout. Changing a trusted source registry binding and rebuilding replaces the actual structure. Neither a copied source file nor a configuration value is a permission grant.

Current JSON overrides are exactly:

| Token                 | Schema constraint                                              | Current use                                         |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| accent                | Six-digit hex color                                            | Actions, focus outlines and accents                 |
| background / surface  | Six-digit hex colors                                           | Page background and component surfaces              |
| text / muted / border | Six-digit hex colors                                           | Foreground, secondary text and boundaries           |
| radius                | Integer 0–32                                                   | Panels and selected containers, converted to pixels |
| fontFamily            | Conservative 1–120-character font-family string; no URL/script | Main body/control typography                        |

The presets also contain onAccent, soft, sidebar, sidebarText, highlight and error colors. Those are currently source-level preset values, not additional accepted JSON overrides. Some typography, spacing, individual control radii, translucent colors and motion values remain explicit CSS values; e.g. title typography uses a serif declaration. Therefore the initial token interface is not a claim that every visual property is already configurable through JSON. Colors passing schema validation are not proof of adequate contrast.

The complete follow-on contract must expose or document app-source replacement for all relevant typography, spacing, status/focus surfaces, radius, motion and layout decisions, while keeping a bounded versioned schema. Add new token keys through schema/source/tests rather than silently accepting arbitrary CSS. A generated config edited directly after generation is a trusted source change requiring validation/build/review; the browser does not re-run the authoring AJV validator or certify the edited theme.

## CSS scope and composition

The current generated app is one standalone Next application. `src/styles.css` defines its own body/universal styles and component classes; variables use the `--app-` prefix and shell classes distinguish layout variants. This is app-owned stylesheet scope, not Shadow DOM isolation, an iframe boundary or a proven embeddable multi-app component library. It may affect another tree if deliberately embedded into a shared document. A future embedding/library requirement must introduce and test an explicit root scope rather than claim the global stylesheet already provides it.

Presets and replacements must not inherit seller logos, storefront copy, illustrative monthly/license prices or cross-app messages implicitly. The starter's English catalog and source are local. Domain/customer-entered text remains data and is never rewritten merely to translate interface labels.

## Current replacement interfaces

| Binding    | Props supplied by Starter                                    | Required behavior for a compatible replacement                                                                                                                                                   |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell      | config, page, i, children, connection, onRefresh, refreshing | Render child content; support current page/navigation, accessible refresh and mode disclosure; preserve safe landmark/focus behavior. Do not infer permissions from page, connection or config.  |
| RecordForm | i, busy, error, onCreate                                     | Submit the intended title/details through onCreate; retain inputs on rejected write; reset/focus only after acknowledged success; preserve labels, limits and accessible pending/error feedback. |
| RecordCard | record, i, busy, onStatus, compact                           | Render record data as escaped text, retain status/revision meaning, invoke the supplied status action with the original record, and omit mutation controls in compact read-only mode.            |

Shell additionally accepts optional `navigationContext` for an app-owned wrapper to provide display permissions/features. The baseline Starter does not derive authenticated context; changing it only filters links and never grants API access.

`i` is the app-local localization interface (`t`, `number`, `date`). `page` is a stable route identity, currently overview/records/configuration. `connection` is connecting/connected/unavailable and describes API transport only, never identity, live AI or production readiness. `onRefresh` requests current backend state; `refreshing` disables repeated refresh. Replacement views must not fabricate successful state or invent a record revision.

`onCreate({title, details})` resolves true when the server acknowledges the write, or false on rejection. It is not a guarantee that the subsequent refresh succeeded; Starter displays the acknowledged saved result and any separate refresh failure honestly. Default fields trim text, require title, and use native length limits of 200/2000; backend validation remains authoritative. Custom controls must not send additional identity/role/target-URL values or bypass the data boundary.

`onStatus(record)` delegates the intent to the controller, which sends the next todo/done state and the record's expected_revision. The backend decides whether it is valid and rejects stale state with 409. Replacing a card must not silently change the selected record/action or treat optimistic UI as confirmed persistence.

Registry replacement is a source compatibility contract, not a sandbox against a malicious owner who edits all source. Codex reviews assigned implementation and actual test evidence before claiming a compatible shipped replacement.

## Keyboard, dialog, form and error obligations

The default Shell has a skip link targeting `main-content`, a focusable main landmark, native buttons/links, translated navigation names, aria-current for the selected route and aria-expanded on the mobile trigger. Mobile navigation uses a native dialog opened with showModal. Explicit close and Escape call closeMenu, which updates state and focuses the trigger; selecting a route closes the dialog and follows navigation. Native modal behavior provides browser focus containment/background inertness, but each supported browser and replacement still needs keyboard/screen-reader tests.

Current implementation gaps are explicit: the mobile dialog has no dedicated accessible name or trigger aria-controls association yet; new-route focus behavior, exhaustive tab order, screen-reader announcements, zoom/reflow and high-contrast behavior have not been fully accepted. Follow-on implementation/review must name the dialog, bind controls as appropriate and verify focus opening, containment, Escape/close restoration and route-change behavior. Six successful mouse-driven mobile menu checks are not this full keyboard acceptance.

The default RecordForm uses nested native labels, required/maxLength inputs, submit handling that prevents navigation, aria-busy and a disabled fieldset while a write is pending. Global error feedback has role=alert and a stable workspace-error ID referenced by the form; success feedback uses role=status. This is current generic request/error association, not field-specific error mapping. Future field-specific responses must identify invalid controls, use stable localized codes and expose aria-invalid/described-by where applicable without relying on color alone.

A replacement must retain native or equivalent keyboard-operable controls, visible focus, meaningful names, pending/disabled semantics, actual result announcements and preservation of user input on failure. Records and returned error content must not be injected as raw HTML; the current controller translates allowlisted codes and current React views escape record strings. Do not render backend traces, credentials or unrestricted model output into the DOM.

## Navigation and localization boundary

`src/navigation.manifest.json` owns trusted source data, validated by `src/navigation.js` against the versioned `navigation.schema.json` contract: stable IDs, safe in-app hrefs, English label keys, registered icon bindings, groups/order and parent hierarchy. Sidebar/top layouts show the complete manifest in one region; combined separates main and resource groups, while mobile includes all entries. The layout choice and source-local manifest are validated data. Optional permission/feature metadata filters visibility using explicit context and hides descendants when a parent is hidden; it is never a permission engine, remotely executable plugin loader or backend authorization. Source validation rejects unknown fields, unsafe links, unresolved bindings/parents, cycles and excessive hierarchy depth. Follow-on FORMA-0035 must verify keyboard/overflow behavior and app-owned rendering; authenticated routes still require independent server authorization.

Every starter-owned visible label, heading, action, notification and error is in `src/messages/en.json`; app names and record data are customer input, not translation keys. `src/i18n.js` supports English fallback, named placeholders, plural selection and locale formatting. Current supported locale is en-US and document direction is ltr. Actual non-English catalogs, RTL layouts and linguistic review are not delivered by English helper tests. Follow-on FORMA-0032 must test full long-text/RTL/keyboard/mobile behavior and retain stable route/API/status IDs.

## Future auth presentation slots — not implemented

Password, verification/reset, authenticator enrollment/challenge/recovery, social-provider actions, reauthentication and signed-in session views are not currently registry bindings or functioning flows. The initial manifest supports auth mode none only; requesting unsupported auth/2FA/provider options fails, and RootLayout refuses a conflicting auth configuration. Do not create decorative login buttons, bypass sessions or label the public records starter authenticated.

The proposed future interface separates:

- Trusted app-owned AuthLayout/provider-button/identifier-password/challenge/recovery/reauthentication views, whose full DOM, branding and layout can be replaced.
- Maintained-library controller/server state for configured providers, session and bound/expiring challenge status, verification, revocation, roles and authorization.
- Explicit action callbacks and stable error codes; no client-supplied '2FA complete', user ID, hidden-nav state or role flag grants access.

Exact names/props require versioned implementation and Saurya's identity contract; these bullet labels are not published component exports. Saurya's actual maintained-library investigation also found that enrollment metadata such as user.twoFactorEnabled is not proof of challenge completion for this session, and social-provider callbacks must not be assumed to receive the same local-MFA handling as password/username sign-in. Unsupported provider-plus-MFA combinations stay rejected until the selected maintained version and session-assurance flow are tested. Preserve maintained-library applicable CSRF/OAuth state/PKCE, challenge expiry/binding, generic anti-enumeration behavior, account-linking policy and reauthentication. User-entered credentials/codes and any controlled enrollment/recovery display are transient intended flow data; they must not be logged, put into general app config or persisted in browser storage. Provider and signing secrets remain server/seller-owned. Python authorization is enforced by the agreed server identity boundary independently of the view.

While auth is none, compatible default/replacement views retain truthful public-synthetic/no-auth disclosure and do not invite real customer data. A future authenticated product changes that presentation only after its actual security/provider acceptance, not merely because a buyer changes CSS or a label.

## Evidence and remaining acceptance

Source inspected for this document: current theme/navigation/i18n helpers; component registry; Shell/RecordForm/RecordCard; Starter; RootLayout; config schema/validator; frontend presentation/proxy tests; root neutral-consumer and visual harness/reports. This is documentation work only; no frontend implementation was changed for FORMA-0030.

Existing evidence at the neutral source milestone:

- Eleven frontend Node tests cover layout route coverage/stable identities, preset override nonmutation, English fallback/plurals, saved-record counts, same-origin/fixed-loopback proxy boundaries and failure/credential-redaction behavior.
- The root installed-package consumer proves external source installation/tests/build/start, acknowledged record operations, stale/foreign-origin denial and restart persistence.
- The root visual harness ran linen/midnight × sidebar/top/combined at desktop/mobile sizes, checked record persistence/mobile navigation/no page overflow/no browser page errors, and demonstrated replacing the shell's whole structure in copied customer source. The actual report is `.run/neutral-consumer/visual-report.json`; selected actual screenshots are tracked under `docs/screenshots/`.

Those six combinations and one structural replacement do not certify a complete screen-reader/keyboard/contrast audit, RTL/long translations, all replacement behavior, every theme override, production authentication or hosted deployment. In particular the minimal replacement fixture proves source/DOM independence; it does not by itself prove the replacement satisfied every accessibility obligation above. Full follow-on acceptance needs focused interaction/negative-state tests and reviewer evidence against these contracts, not a build or screenshots alone.
