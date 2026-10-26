# App-owned frontend source

This Next.js frontend is copied into a generated child app. It reads that child's root `app.config.json`; do not treat this template folder as an independently configured project before generation. Required source, styles and English messages are included here, without private Forma package or seller checkout imports.

From the generated project root, `npm run build --workspace frontend` builds the frontend and `npm run test --workspace frontend` checks presentation data contracts and the actual server proxy security boundary. The root launcher runs the Python API and Next separately. Frontend scripts default to loopback/port3000; the launcher may pass another port. Server-only `FORMA_BACKEND_URL` selects an HTTP loopback backend (default `http://127.0.0.1:8765`); neither JSON configuration nor browser input can select an upstream target.

## Customize owned source

- `src/components/registry.jsx`: replace Shell, RecordForm or RecordCard as complete trusted source components. Preserve callbacks, keyboard/focus behavior and accessible feedback. JSON configuration does not execute arbitrary component code.
- `src/navigation.js`: stable IDs/routes/label keys and groups; sidebar, top, combined and mobile renderers use the same manifest. Visibility is not backend authorization.
- `src/theme.js`, `src/styles.css`: linen/midnight presets, semantic token overrides and app-owned layout/styles. No Kernel brand or storefront pricing fallback.
- `src/messages/en.json`, `src/i18n.js`: complete starter English UI copy, plurals and locale formatting. Other locales/RTL are not published or visually accepted by this initial starter.
- `src/Starter.jsx`: the synthetic record workflow; backend state/revisions remain authoritative.

## Explicit limits

This is a public synthetic development starter. Password/2FA/social auth, live AI, payments, license issuance, hosted operations and production security are NOT included. Missing/forged identity cannot be claimed denied because this version intentionally has no human identity capability. Never enter real customer data.

The same-origin server proxy rejects foreign browser write origins, nonlocal hosts, unsupported routes/methods, non-JSON/oversized writes and unsafe backend targets; it forwards no cookies/authorization/arbitrary headers and no redirects. Native clients with absent Origin may call this explicitly public local service. It is not an authentication boundary or production reverse proxy. Direct backend access is a separate loopback-only public development endpoint. Stable error codes are localized; backend traces/secret diagnostics are not shown.

Evidence for independent installation/build/browser flow must come from the generated external consumer, not these template files or pure unit tests alone.

## Versioned source navigation manifest

`src/navigation.manifest.json` is the app-owned data source, with `src/navigation.schema.json` as its strict version-1 format and `validateNavigation` as the actual runtime validator. Imported JSON is validated before rendering. Stable IDs, safe in-app hrefs, English label keys, registered icons, main/resources groups, order and parent links are explicit. Missing bindings, unknown fields, duplicates, unsafe URL/code values, unresolved/cyclic/cross-group parents and excessive depth fail clearly. Source route safety is checked; adding a new href still requires implementing and testing its actual Next page. Arbitrary network menus/plugins are not loaded.

The same normalized manifest feeds side/top/combined/mobile regions and the current-page breadcrumb label; a fixed-page/generic safe label fallback handles a deliberately omitted menu item. Nested native lists preserve declared parent/child structure; default routes remain unchanged. Replacing renderers does not change stable IDs or turn labels into identity. Icon bindings currently supported by this manifest version are overview, records and source; introducing more requires deliberate schema/source/tests.

Optional `visibility.allPermissions` and `visibility.allFeatures` declare presentation gates. `navigationFor` accepts an explicit context with permissions array and featureFlags object; missing permissions/flags and non-true flags hide that item and its descendants. The Shell accepts an optional trusted-source `navigationContext`; the public starter does not invent user roles or server permissions. This filter never protects a page or API: direct authorization is independent backend work. Do not persist or infer identity from a hidden menu, a browser flag or this context.

`test/navigation.test.mjs` exercises invalid manifests, binding checks, hierarchy, deterministic nonmutation and fail-closed visibility. These tests and existing browser layouts do not claim full assistive-technology/RTL/contrast acceptance or an authenticated navigation system.
