import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ConfigError,
  defaultConfig,
  validateConfig,
  validateBlueprint,
  resolveModules,
  safeRelative,
} from "../src/index.mjs";
const source = JSON.parse(
  fs.readFileSync(
    new URL("../../../blueprints/application/blueprint.json", import.meta.url),
  ),
);
const manifest = () => structuredClone(source);

test("normalizes dependency closure deterministically without mutating input", () => {
  const a = defaultConfig();
  a.modules = ["records"];
  const before = structuredClone(a);
  const result = validateConfig(a, manifest());
  assert.deepEqual(result.modules, [
    "presentation",
    "localization",
    "navigation",
    "records",
  ]);
  assert.deepEqual(a, before);
  assert.deepEqual(
    resolveModules(manifest(), ["records"]),
    resolveModules(manifest(), ["navigation", "records"]),
  );
});
test("accepts supported app-owned layouts and safe semantic theme overrides", () => {
  for (const layout of ["sidebar", "top", "combined"])
    for (const preset of ["linen", "midnight"]) {
      const config = defaultConfig("custom-studio", "Custom Studio");
      config.navigation.layout = layout;
      config.theme = {
        preset,
        tokens: { accent: "#abcdef", radius: 20, fontFamily: "Georgia, serif" },
      };
      assert.equal(
        validateConfig(config, manifest()).navigation.layout,
        layout,
      );
    }
});
test("rejects misspellings, unsafe values and secret fields instead of silently dropping them", () => {
  for (const modify of [
    (c) => (c.extra = true),
    (c) => (c.auth.secret = "secret"),
    (c) => (c.navigation.layot = "top"),
    (c) => (c.id = "../other"),
    (c) => (c.id = "con"),
    (c) => (c.name = " "),
    (c) => (c.theme.tokens.accent = "url(https://example.invalid)"),
    (c) => (c.theme.tokens.radius = -1),
    (c) => (c.extensions = [{ id: "test", source: "../private" }]),
  ]) {
    const value = defaultConfig();
    modify(value);
    assert.throws(() => validateConfig(value, manifest()), ConfigError);
  }
  assert.throws(
    () =>
      validateConfig(
        JSON.parse('{"__proto__":{},"schemaVersion":1}'),
        manifest(),
      ),
    ConfigError,
  );
});
test("does not manufacture authentication or extensions unsupported by this release", () => {
  for (const modify of [
    (c) => (c.auth.mode = "password"),
    (c) => (c.auth.twoFactor = true),
    (c) => (c.auth.providers = ["google"]),
    (c) => (c.modules = ["identity"]),
    (c) => (c.extensions = [{ id: "custom", source: "modules/custom" }]),
  ]) {
    const config = defaultConfig();
    modify(config);
    assert.throws(() => validateConfig(config, manifest()), ConfigError);
  }
  const config = defaultConfig();
  config.modules = ["presentation"];
  assert.throws(() => validateConfig(config, manifest()), /Required baseline/);
});
test("rejects invalid module graphs and ambiguous output before any assembly", () => {
  for (const modify of [
    (m) => m.modules.push(structuredClone(m.modules[0])),
    (m) => (m.modules[0].requires = ["records"]),
    (m) => (m.modules[0].requires = ["missing"]),
    (m) => (m.modules[3].source = [{ from: "backend", to: "Frontend/api" }]),
    (m) => (m.modules[0].source = [{ from: "../private", to: "frontend" }]),
    (m) => (m.requiredModules = ["missing"]),
    (m) => {
      m.modules.push({
        id: "other",
        kind: "domain",
        version: "0.1.0",
        requires: [],
        source: [],
      });
      m.modules[0].requires = ["other"];
    },
  ]) {
    const value = manifest();
    modify(value);
    assert.throws(() => validateBlueprint(value), ConfigError);
  }
});
test("portable relative paths reject traversal, drive paths and reserved device names", () => {
  for (const path of [
    "/tmp/file",
    "../file",
    "frontend/../file",
    "frontend//file",
    "C:/file",
    "frontend\\file",
    "frontend/con.txt",
    "frontend/file.",
    "frontend/file\0",
  ])
    assert.throws(() => safeRelative(path), ConfigError);
  assert.equal(
    safeRelative("frontend/src/components/index.jsx"),
    "frontend/src/components/index.jsx",
  );
});

test("semantic parent token registry matches generator schema and runtime validation", async () => {
  const registry = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../../blueprints/application/frontend/src/theme-tokens.json",
        import.meta.url,
      ),
    ),
  );
  const schema = JSON.parse(
    fs.readFileSync(
      new URL("../../../schemas/app-config.schema.json", import.meta.url),
    ),
  );
  const { themeStyle, validateTheme } = await import(
    "../../../blueprints/application/frontend/src/theme.js"
  );
  assert.deepEqual(
    schema.properties.theme.properties.tokens.properties,
    Object.fromEntries(
      Object.entries(registry).map(([key, definition]) => [
        key,
        definition.schema,
      ]),
    ),
  );
  const config = defaultConfig();
  config.theme.tokens = Object.fromEntries(
    Object.entries(registry).map(([key, definition]) => [
      key,
      definition.default,
    ]),
  );
  validateConfig(config, manifest());
  validateTheme(config.theme);
  assert.equal(themeStyle(config.theme)["--app-motionDuration"], "200ms");
  for (const [key, definition] of Object.entries(registry)) {
    for (const invalid of [
      null,
      {},
      [],
      definition.schema.type === "string"
        ? "url(javascript:bad)"
        : definition.schema.maximum + 1,
      definition.schema.type === "string" ? "" : NaN,
    ]) {
      const bad = defaultConfig();
      bad.theme.tokens = { [key]: invalid };
      assert.throws(() => validateConfig(bad, manifest()), key);
      assert.throws(() => themeStyle(bad.theme), key);
    }
  }
  for (const tokens of [
    { unknownToken: "red" },
    { fontFamily: "Arial; color:red" },
    { fontFamily: "INITIAL" },
    { fontFamily: "UnSeT" },
    { fontFamily: "Arial, INHERIT" },
    { radius: -1 },
    { motionDuration: Infinity },
    { controlFontSize: 12.5 },
  ]) {
    const bad = defaultConfig();
    bad.theme.tokens = tokens;
    assert.throws(() => validateConfig(bad, manifest()));
    assert.throws(() => themeStyle(bad.theme));
  }
});

test("fixed authenticated profile resolves physical module closure and rejects downgrade tuples", () => {
  const config = defaultConfig();
  config.auth = { mode: "password", providers: [], twoFactor: true };
  const result = validateConfig(config, manifest());
  assert.ok(result.modules.includes("identity"));
  assert.ok(result.modules.includes("records-auth"));
  assert.deepEqual(config.modules, defaultConfig().modules);
  for (const auth of [
    { mode: "password", providers: [], twoFactor: false },
    { mode: "social", providers: ["google"], twoFactor: true },
    { mode: "password", providers: ["google"], twoFactor: true },
  ])
    assert.throws(
      () => validateConfig({ ...config, auth }, manifest()),
      /profile/,
    );
  assert.throws(
    () =>
      validateConfig(
        { ...defaultConfig(), modules: [...config.modules, "identity"] },
        manifest(),
      ),
    /Public profile/,
  );
  const bad = manifest();
  bad.profiles[1].modules.push("unknown");
  assert.throws(() => validateBlueprint(bad), /Unknown profile/);
});
