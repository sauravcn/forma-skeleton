import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  validateConfig,
  validateBlueprint,
  safeRelative,
} from "../bundle/config/src/index.mjs";
export { defaultConfig };
export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const excluded = new Set([
  ".git",
  "node_modules",
  ".next",
  ".venv",
  "__pycache__",
  ".run",
  "data",
  "dist",
  "build",
]);
function forbidden(name) {
  return (
    excluded.has(name) ||
    (/\.env(?:\.|$)/.test(name) && name !== ".env.example") ||
    /\.(?:pyc|db|sqlite3?|pem|key)$/.test(name)
  );
}
export async function readBundle(root = path.join(packageRoot, "bundle")) {
  const manifest = validateBlueprint(
      JSON.parse(
        await fs.readFile(path.join(root, "blueprint/blueprint.json"), "utf8"),
      ),
    ),
    provenance = JSON.parse(
      await fs.readFile(path.join(root, "provenance.json"), "utf8"),
    );
  for (const [relative, expected] of Object.entries(provenance.files)) {
    safeRelative(relative);
    const full = path.join(root, relative),
      stat = await fs.lstat(full);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      hash(await fs.readFile(full)) !== expected
    )
      throw new Error(`Bundled source integrity check failed: ${relative}`);
  }
  if (hash(JSON.stringify(provenance.files)) !== provenance.snapshotHash)
    throw new Error("Bundled source inventory digest mismatch");
  return { root, manifest, provenance };
}
export async function destinationPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").includes("..") ||
    /^[A-Za-z]:/.test(value)
  )
    throw new Error(
      "Destination must be a safe local path without traversal or drive syntax",
    );
  const destination = path.resolve(value),
    parent = path.dirname(destination),
    basename = path.basename(destination);
  if (destination === parent)
    throw new Error("Filesystem root cannot be an app destination");
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
    throw new Error("Destination parent must be an existing real directory");
  if (
    await fs.lstat(destination).then(
      () => true,
      (e) => {
        if (e.code === "ENOENT") return false;
        throw e;
      },
    )
  )
    throw new Error("Destination already exists; no files were changed");
  return { destination, parent, basename };
}
export async function planGeneration(config, destination, { bundle } = {}) {
  bundle ??= await readBundle();
  const normalized = validateConfig(config, bundle.manifest),
    output = await destinationPath(destination),
    files = new Map();
  function add(relative, bytes, origin) {
    safeRelative(relative);
    const key = relative.toLowerCase();
    for (const existing of files.keys())
      if (
        existing.toLowerCase() === key ||
        existing.toLowerCase().startsWith(key + "/") ||
        key.startsWith(existing.toLowerCase() + "/")
      )
        throw new Error(`Output source collision: ${relative}`);
    files.set(relative, { bytes, origin });
  }
  async function walk(source, relative, origin) {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink())
      throw new Error(`Source symlinks are not supported: ${origin}`);
    if (forbidden(path.basename(source)))
      throw new Error(`Excluded private/runtime artifact in source: ${origin}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(source)).sort())
        await walk(
          path.join(source, name),
          relative + "/" + name,
          origin + "/" + name,
        );
    } else if (stat.isFile()) {
      const bytes = await fs.readFile(source),
        key = "blueprint/" + origin;
      if (bundle.provenance.files[key] !== hash(bytes))
        throw new Error(`Unpinned or changed source file: ${origin}`);
      add(relative, bytes, origin);
    } else throw new Error(`Unsupported source type: ${origin}`);
  }
  const selected = new Set(normalized.modules),
    mappings = [
      ...bundle.manifest.source,
      ...bundle.manifest.modules
        .filter((m) => selected.has(m.id))
        .flatMap((m) => m.source),
    ];
  for (const mapping of mappings) {
    safeRelative(mapping.from);
    safeRelative(mapping.to);
    let current = path.join(bundle.root, "blueprint");
    for (const segment of mapping.from.split("/")) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error(`Source symlink is unsafe: ${mapping.from}`);
    }
    await walk(current, mapping.to, mapping.from);
  }
  const profile = normalized.auth.mode === "none" ? "public" : "password-totp";
  if (profile !== "public") {
    for (const required of [
      "identity/node/application.mjs",
      "identity/node/start.mjs",
      "identity/node/migrate.mjs",
      "identity/node/next-adapter.mjs",
      "identity/frontend/identity-client.jsx",
      "identity/core/lifecycle/src/identity.mjs",
      "identity/core/lifecycle/src/assurance.mjs",
      "identity/core/boundary/python/identity_client.py",
      "backend-auth/server.py",
      "backend-auth/migrate.py",
      "backend-auth/repository.py",
      "backend-auth/policy.mjs",
      "backend-auth/migrations/base/001_records.sql",
      "backend-auth/migrations/002_ownership.sql",
    ]) {
      if (!files.has(required))
        throw new Error(
          `Authenticated source closure is incomplete: ${required}`,
        );
    }
  }
  for (const name of ["identity-server.mjs", "identity-client.jsx"]) {
    const asset = `selectors/${profile}/${name}`;
    add(
      `frontend/src/${name}`,
      await fs.readFile(path.join(bundle.root, "assets", asset)),
      `generator-assets/${asset}`,
    );
  }
  for (const [asset, target] of [
    [
      profile === "public" ? "scripts/run.mjs" : "scripts/run-auth.mjs",
      "scripts/run.mjs",
    ],
    ["_gitignore", ".gitignore"],
    [
      profile === "public"
        ? "ENVIRONMENT.example"
        : "ENVIRONMENT-authenticated.example",
      ".env.example",
    ],
    [
      profile === "public"
        ? "THIRD_PARTY_NOTICES"
        : "THIRD_PARTY_NOTICES-authenticated",
      "THIRD_PARTY_NOTICES",
    ],
    [
      profile === "public" ? "AGENTS.md" : "AGENTS-authenticated.md",
      "AGENTS.md",
    ],
    [
      profile === "public"
        ? "contracts/records.openapi.json"
        : "contracts/records-auth.openapi.json",
      "contracts/records.openapi.json",
    ],
  ])
    add(
      target,
      await fs.readFile(path.join(bundle.root, "assets", asset)),
      `generator-assets/${asset}`,
    );
  if (profile !== "public") {
    add(
      "identity/package.json",
      await fs.readFile(path.join(bundle.root, "assets/identity-package.json")),
      "generator-assets/identity-package.json",
    );
  }
  if (profile !== "public") {
    const contract = files.get("contracts/records.openapi.json");
    const specification = JSON.parse(contract.bytes.toString());
    specification.components.securitySchemes.sessionCookie.name = `${normalized.id}-candidate.session_token`;
    contract.bytes = Buffer.from(json(specification));
  }
  // App metadata is data, never interpolation into executable source.
  if (files.has("frontend/package.json")) {
    const record = files.get("frontend/package.json"),
      manifest = JSON.parse(record.bytes.toString());
    manifest.name = `@${normalized.id}/frontend`;
    if (profile !== "public") manifest.dependencies.qrcode = "1.5.4";
    record.bytes = Buffer.from(json(manifest));
  }
  add(
    "package.json",
    Buffer.from(
      json({
        name: normalized.id,
        version: "0.1.0",
        private: true,
        type: "module",
        workspaces:
          profile === "public" ? ["frontend"] : ["frontend", "identity"],
        engines: { node: ">=22" },
        scripts: {
          build: "node scripts/run.mjs build",
          test: "node scripts/run.mjs test",
          start: "node scripts/run.mjs start",
          dev: "node scripts/run.mjs dev",
          ...(profile === "public"
            ? {}
            : { migrate: "node identity/node/migrate.mjs" }),
        },
      }),
    ),
    "generated-config",
  );
  const lock = JSON.parse(
    await fs.readFile(
      path.join(
        bundle.root,
        profile === "public"
          ? "assets/starter-lock.json"
          : "assets/authenticated-lock.json",
      ),
      "utf8",
    ),
  );
  const frontendPackage = JSON.parse(
    files.get("frontend/package.json").bytes.toString(),
  );
  if (
    JSON.stringify(
      Object.entries(lock.packages.frontend.dependencies).sort(),
    ) !== JSON.stringify(Object.entries(frontendPackage.dependencies).sort())
  )
    throw new Error(
      "Pinned starter lock no longer matches frontend dependencies; rebuild the approved lock fixture before release",
    );
  const originalScope = lock.packages.frontend.name;
  lock.name = normalized.id;
  lock.packages[""].name = normalized.id;
  lock.packages.frontend.name = `@${normalized.id}/frontend`;
  const link = lock.packages[`node_modules/${originalScope}`];
  if (!link?.link || link.resolved !== "frontend")
    throw new Error("Pinned workspace link is invalid");
  delete lock.packages[`node_modules/${originalScope}`];
  lock.packages[`node_modules/@${normalized.id}/frontend`] = link;
  if (profile !== "public") {
    const record = files.get("identity/package.json");
    if (!record) throw new Error("Authenticated module package is missing");
    const identityPackage = JSON.parse(record.bytes.toString());
    if (
      JSON.stringify(
        Object.entries(lock.packages.identity.dependencies).sort(),
      ) !== JSON.stringify(Object.entries(identityPackage.dependencies).sort())
    )
      throw new Error(
        "Pinned authenticated lock no longer matches identity dependencies",
      );
    const original = lock.packages.identity.name;
    const identityLink = lock.packages[`node_modules/${original}`];
    if (!identityLink?.link || identityLink.resolved !== "identity")
      throw new Error("Pinned identity workspace link is invalid");
    delete lock.packages[`node_modules/${original}`];
    lock.packages[`node_modules/@${normalized.id}/identity`] = identityLink;
    identityPackage.name = `@${normalized.id}/identity`;
    lock.packages.identity.name = identityPackage.name;
    record.bytes = Buffer.from(json(identityPackage));
  }
  add(
    "package-lock.json",
    Buffer.from(json(lock)),
    `generator-assets/${profile === "public" ? "starter-lock.json" : "authenticated-lock.json"}`,
  );
  add("app.config.json", Buffer.from(json(normalized)), "generated-config");
  const readme = await fs.readFile(
    path.join(
      bundle.root,
      profile === "public"
        ? "assets/README.md"
        : "assets/README-authenticated.md",
    ),
    "utf8",
  );
  add(
    "README.md",
    Buffer.from(readme.replaceAll("{{APP_NAME}}", () => normalized.name)),
    `generator-assets/${profile === "public" ? "README.md" : "README-authenticated.md"}`,
  );
  const modules = normalized.modules.map((id) => {
      const module = bundle.manifest.modules.find((m) => m.id === id);
      return { id, version: module.version };
    }),
    templateSources = {};
  for (const [name, record] of files)
    templateSources[name] = {
      sha256: hash(record.bytes),
      origin: record.origin,
    };
  add(
    "blueprint.lock.json",
    Buffer.from(
      json({
        schemaVersion: 1,
        blueprint: { id: bundle.manifest.id, version: bundle.manifest.version },
        generator: { name: "create-forma-app", version: "0.1.0" },
        modules,
        profile,
        source: {
          repository: bundle.provenance.repository,
          revision: bundle.provenance.revision,
          dirty: bundle.provenance.dirty,
          snapshotHash: bundle.provenance.snapshotHash,
          vendored: bundle.provenance.vendored || [],
        },
        baseline: templateSources,
      }),
    ),
    "generated-provenance",
  );
  const inventory = {};
  for (const [name, record] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    inventory[name] = { sha256: hash(record.bytes), origin: record.origin };
  add(
    "SOURCE_MANIFEST.json",
    Buffer.from(
      json({ schemaVersion: 1, excludesSelf: true, files: inventory }),
    ),
    "generated-inventory",
  );
  return { ...output, config: normalized, files };
}
export async function generate(config, destination, options = {}) {
  const plan = await planGeneration(config, destination, options);
  return writePlan(plan, options);
}
export async function writePlan(plan, options = {}) {
  if (options.dryRun)
    return {
      destination: plan.destination,
      config: plan.config,
      files: [...plan.files.keys()].sort(),
      dryRun: true,
    };
  const staging = await fs.mkdtemp(
      path.join(plan.parent, `.${plan.basename}.forma-stage-`),
    ),
    token = randomUUID();
  let reserved = false,
    completed = false;
  try {
    for (const [relative, { bytes }] of plan.files) {
      const target = path.join(staging, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: "wx" });
    }
    // mkdir is the portable exclusive claim. Never rename over an arbitrary
    // existing empty directory after a check-then-rename race.
    await fs.mkdir(plan.destination);
    reserved = true;
    await fs.writeFile(
      path.join(plan.destination, ".forma-generation.pending"),
      token,
      { flag: "wx" },
    );
    // A visible exclusive reservation exists briefly; this is not advertised as a
    // portable whole-directory no-replace transaction. Crash leaves an explicit marker.
    for (const name of await fs.readdir(staging))
      await fs.rename(
        path.join(staging, name),
        path.join(plan.destination, name),
      );
    await fs.writeFile(
      path.join(plan.destination, ".forma-generation.json"),
      json({ schemaVersion: 1, state: "complete" }),
      { flag: "wx" },
    );
    if (
      (await fs.readFile(
        path.join(plan.destination, ".forma-generation.pending"),
        "utf8",
      )) !== token
    )
      throw new Error(
        "Generation reservation changed; inspect output before retrying",
      );
    await fs.unlink(path.join(plan.destination, ".forma-generation.pending"));
    completed = true;
    return {
      destination: plan.destination,
      config: plan.config,
      files: [...plan.files.keys()].sort(),
      dryRun: false,
    };
  } catch (error) {
    if (reserved && !completed)
      error.message +=
        "; reserved output may contain an incomplete generation, preserve/inspect .forma-generation.pending before manual recovery";
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
