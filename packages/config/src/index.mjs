import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// The packed CLI vendors this directory with its own adjacent schemas.
const schemaRoot = fs.existsSync(path.resolve(here, "../schemas"))
  ? path.resolve(here, "../schemas")
  : path.resolve(here, "../../../schemas");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const appSchema = JSON.parse(
  fs.readFileSync(path.join(schemaRoot, "app-config.schema.json"), "utf8"),
);
const blueprintSchema = JSON.parse(
  fs.readFileSync(path.join(schemaRoot, "blueprint.schema.json"), "utf8"),
);
const appCheck = ajv.compile(appSchema),
  blueprintCheck = ajv.compile(blueprintSchema);
export class ConfigError extends Error {
  constructor(errors) {
    super(errors.join("; "));
    this.name = "ConfigError";
    this.errors = errors;
  }
}
function fail(message) {
  throw new ConfigError([message]);
}
function check(validator, value, label) {
  if (!validator(value))
    throw new ConfigError(
      validator.errors.map(
        (e) => `${label}${e.instancePath || "/"} ${e.message}`,
      ),
    );
}
function safeKeys(value) {
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        fail("Unsafe object key");
      safeKeys(child);
    }
}
export function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(":") ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (s) =>
          !s ||
          s === "." ||
          s === ".." ||
          /[. ]$/.test(s) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
      ) ||
    /[<>"|?*\x00-\x1f]/.test(value)
  )
    fail("Source paths must be safe relative POSIX paths");
  return value;
}
export function validateBlueprint(manifest) {
  safeKeys(manifest);
  check(blueprintCheck, manifest, "blueprint");
  const byId = new Map();
  for (const module of manifest.modules) {
    if (byId.has(module.id)) fail("Duplicate module ID");
    byId.set(module.id, module);
  }
  for (const id of manifest.requiredModules)
    if (!byId.has(id)) fail(`Unknown required module: ${id}`);
  for (const module of manifest.modules)
    if (
      module.kind === "foundation" &&
      module.requires.some((id) => byId.get(id)?.kind === "domain")
    )
      fail("Foundation modules cannot depend on domain policy");
  const profileIds = new Set();
  for (const profile of manifest.profiles || []) {
    if (profileIds.has(profile.id)) fail("Duplicate profile ID");
    profileIds.add(profile.id);
    if (profile.modules.some((id) => !byId.has(id)))
      fail("Unknown profile module");
    if (
      (profile.id === "public" &&
        (profile.auth.mode !== "none" ||
          profile.auth.twoFactor ||
          profile.modules.length)) ||
      (profile.id === "password-totp" &&
        (profile.auth.mode !== "password" ||
          !profile.auth.twoFactor ||
          !["identity", "records-auth"].every((id) =>
            profile.modules.includes(id),
          )))
    )
      fail("Invalid fixed authentication profile contract");
  }
  const outputs = [];
  for (const mapping of [
    ...manifest.source,
    ...manifest.modules.flatMap((m) => m.source),
  ]) {
    safeRelative(mapping.from);
    safeRelative(mapping.to);
    const lower = mapping.to.toLowerCase();
    if (
      outputs.some(
        (p) =>
          p === lower || p.startsWith(lower + "/") || lower.startsWith(p + "/"),
      )
    )
      fail("Overlapping or case-colliding source destinations");
    outputs.push(lower);
  }
  const visited = new Set(),
    active = new Set();
  function visit(id) {
    if (active.has(id)) fail("Module dependency cycle");
    if (visited.has(id)) return;
    const module = byId.get(id);
    if (!module) fail(`Unknown module dependency: ${id}`);
    active.add(id);
    for (const dep of module.requires) visit(dep);
    active.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return structuredClone(manifest);
}
export function resolveModules(manifest, ids) {
  validateBlueprint(manifest);
  if (
    !Array.isArray(ids) ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string")
  )
    fail("Module selection must contain unique IDs");
  const byId = new Map(manifest.modules.map((m) => [m.id, m])),
    seen = new Set(),
    ordered = [];
  function visit(id) {
    const module = byId.get(id);
    if (!module) fail(`Unsupported module: ${id}`);
    if (seen.has(id)) return;
    for (const dep of [...module.requires].sort()) visit(dep);
    seen.add(id);
    ordered.push(module);
  }
  for (const id of [...ids].sort()) visit(id);
  return ordered.map((m) => structuredClone(m));
}
export function defaultConfig(id = "sample-app", name = "Sample App") {
  return {
    schemaVersion: 1,
    id,
    name,
    modules: ["presentation", "localization", "navigation", "records"],
    navigation: { layout: "sidebar" },
    theme: { preset: "linen", tokens: {} },
    auth: { mode: "none", providers: [], twoFactor: false },
    locale: "en-US",
    extensions: [],
  };
}
export function validateConfig(value, manifest) {
  safeKeys(value);
  check(appCheck, value, "config");
  validateBlueprint(manifest);
  if (value.name !== value.name.trim() || !value.name.trim())
    fail("App name must be nonempty trimmed text");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value.id))
    fail("Reserved app ID");
  const profiles = manifest.profiles;
  const profile = profiles?.find(
    (candidate) =>
      candidate.auth.mode === value.auth.mode &&
      candidate.auth.twoFactor === value.auth.twoFactor &&
      JSON.stringify(candidate.auth.providers) ===
        JSON.stringify(value.auth.providers),
  );
  if (profiles && !profile) fail("Unsupported authentication profile tuple");
  if (
    profile?.id === "public" &&
    value.modules.some((id) => ["identity", "records-auth"].includes(id))
  )
    fail("Public profile cannot include authenticated runtime modules");
  const selected = resolveModules(manifest, [
    ...new Set([...value.modules, ...(profile?.modules || [])]),
  ]);
  const ids = new Set(selected.map((m) => m.id));
  for (const id of manifest.requiredModules)
    if (!ids.has(id)) fail(`Required baseline module missing: ${id}`);
  const cap = manifest.capabilities;
  if (
    !cap.authModes.includes(value.auth.mode) ||
    value.auth.providers.some((p) => !cap.providers.includes(p)) ||
    (value.auth.twoFactor && !cap.twoFactor)
  )
    fail(
      "Requested authentication capability is not implemented by this blueprint",
    );
  if (
    value.auth.mode === "none" &&
    (value.auth.providers.length || value.auth.twoFactor)
  )
    fail("No-auth mode cannot enable providers or two-factor");
  if (value.extensions.length && !cap.extensions)
    fail("Domain extension generation is not implemented by this blueprint");
  for (const extension of value.extensions) safeRelative(extension.source);
  const normalized = structuredClone(value);
  normalized.modules = selected.map((m) => m.id);
  return normalized;
}
