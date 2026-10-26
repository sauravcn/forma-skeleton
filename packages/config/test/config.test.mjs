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
