import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  templates,
  readTemplate,
  serializeTemplate,
} from "../src/templates.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--catalog-dir"))
  throw new Error("Usage: build.mjs [--catalog-dir /reviewed/exports]");
const catalog = args[1] || process.env.FORMA_TEMPLATE_CATALOG_DIR;
const here = path.dirname(fileURLToPath(import.meta.url)),
  pkg = path.resolve(here, ".."),
  repo = path.resolve(pkg, "../.."),
  bundle = path.join(pkg, "bundle");
const exists = async (p) =>
  !!(await fs.lstat(p).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  }));
async function copy(source, target) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink())
    throw new Error(`Bundled source must not be a symlink: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) {
      if (
        [
          "node_modules",
          ".next",
          ".git",
          "__pycache__",
          ".venv",
          "data",
          ".run",
          "dist",
          "build",
        ].includes(name)
      )
        continue;
      await copy(path.join(source, name), path.join(target, name));
    }
  } else if (stat.isFile()) {
    if (
      /(?:\.pyc|\.db|\.sqlite3?|\.pem|\.key)$/.test(source) ||
      (/(?:^|\/)\.env(?:\.|$)/.test(source) && !source.endsWith(".env.example"))
    )
      throw new Error(
        `Excluded generated/private artifact in blueprint: ${source}`,
      );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } else throw new Error(`Unsupported bundled source type: ${source}`);
}
const source = path.join(repo, "blueprints/application/blueprint.json");
if (!(await exists(source))) {
  if (await exists(path.join(bundle, "provenance.json"))) {
    console.error(
      "Using previously bundled source snapshot; no seller checkout required.",
    );
    process.exit(0);
  }
  throw new Error("Missing authoring blueprint and packaged snapshot");
}
const temporary = await fs.mkdtemp(path.join(pkg, ".bundle-"));
try {
  await copy(
    path.join(repo, "packages/config/src"),
    path.join(temporary, "config/src"),
  );
  await copy(
    path.join(repo, "schemas"),
    path.join(temporary, "config/schemas"),
  );
  await copy(
    path.join(repo, "blueprints/application"),
    path.join(temporary, "blueprint"),
  );
  // Canonical same-repository source becomes ordinary child-owned physical source.
  // Snapshot hashes below cover every vendored byte; generation never needs this checkout.
  const vendored = [
    [
      "packages/identity-lifecycle/src",
      "modules/identity/runtime/core/lifecycle/src",
    ],
    [
      "packages/identity-boundary/python/identity_client.py",
      "modules/identity/runtime/core/boundary/python/identity_client.py",
    ],
    [
      "blueprints/application/modules/identity-ui/src",
      "modules/identity/runtime/frontend/presentation",
    ],
    [
      "blueprints/application/backend/starter_api/migrations",
      "modules/records-auth/runtime/migrations/base",
    ],
  ];
  for (const [origin, destination] of vendored) {
    const target = path.join(temporary, "blueprint", destination);
    if (await exists(target))
      throw new Error(`Vendored source collision: ${destination}`);
    await copy(path.join(repo, origin), target);
  }
  await copy(path.join(pkg, "assets"), path.join(temporary, "assets"));
  if (catalog) {
    if (await exists(path.join(catalog, ".catalog.pending")))
      throw new Error("Template catalog is incomplete");
    for (const id of templates) {
      const template = await readTemplate(
        path.join(path.resolve(catalog), id),
        id,
      );
      await fs.mkdir(path.join(temporary, "templates"), { recursive: true });
      await fs.writeFile(
        path.join(temporary, "templates", `${id}.json`),
        serializeTemplate(template, id),
        { flag: "wx" },
      );
    }
  }
  let revision = null,
    dirty = null;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    dirty = !!execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: repo, encoding: "utf8" },
    ).trim();
  } catch {
    /* An extracted source archive may have no Git metadata. */
  }
  const files = {};
  async function hash(dir) {
    for (const name of (await fs.readdir(dir)).sort()) {
      const full = path.join(dir, name),
        stat = await fs.stat(full);
      if (stat.isDirectory()) await hash(full);
      else
        files[path.relative(temporary, full).split(path.sep).join("/")] =
          createHash("sha256")
            .update(await fs.readFile(full))
            .digest("hex");
    }
  }
  await hash(temporary);
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(files))
    .digest("hex");
  await fs.writeFile(
    path.join(temporary, "provenance.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        repository: "https://github.com/sauravcn/forma-skeleton",
        revision,
        dirty,
        snapshotHash,
        vendored: vendored.map(([origin, destination]) => ({
          origin,
          destination,
        })),
        files,
      },
      null,
      2,
    ) + "\n",
  );
  await fs.rm(bundle, { recursive: true, force: true });
  await fs.rename(temporary, bundle);
  console.error(
    `Bundled blueprint/config source snapshot ${snapshotHash.slice(0, 12)}${dirty ? " (working-tree changes explicitly recorded)" : ""}.`,
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
