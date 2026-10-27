import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export const templates = [
  "field-service",
  "accounting-studio",
  "table-kitchen",
  "clinic-desk",
  "client-studio",
  "care-center",
];
const sha = (value) => createHash("sha256").update(value).digest("hex");
function safe(name) {
  if (
    !name ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.split("/").some((x) => !x || x === "." || x === "..") ||
    /^[A-Za-z]:/.test(name)
  )
    throw new Error("Unsafe template source path");
}
function permitted(relative) {
  safe(relative);
  for (const name of relative.split("/")) {
    if (
      [
        "node_modules",
        ".git",
        ".next",
        ".run",
        "__pycache__",
        ".venv",
        "data",
        "dist",
        "build",
      ].includes(name) ||
      /\.(?:pyc|db|sqlite3?|pem|key)$/i.test(name) ||
      (name.startsWith(".env") && name !== ".env.example") ||
      (/(?:^|[-_.])(?:credentials?|secrets?|tokens?)(?:[-_.]|$)/i.test(name) &&
        name.endsWith(".json") &&
        !name.endsWith(".schema.json"))
    )
      throw new Error(`Private/runtime artifact in template: ${relative}`);
  }
}
// Exact inventory validation precedes any destination creation or source copying.
export async function readTemplate(root, id) {
  if (!templates.includes(id)) throw new Error(`Unknown app template: ${id}`);
  const files = new Map();
  async function walk(dir, prefix = "") {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Template root must be a real directory");
    for (const name of (await fs.readdir(dir)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      safe(relative);
      permitted(relative);
      const full = path.join(dir, name),
        entry = await fs.lstat(full);
      if (entry.isSymbolicLink())
        throw new Error("Template symlinks are refused");
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile())
        files.set(relative, {
          bytes: await fs.readFile(full),
          origin: "reviewed-app-export",
        });
      else throw new Error("Unsupported template source type");
    }
  }
  await walk(root);
  return validateTemplate(files, id);
}
export function validateTemplate(files, id) {
  if (!templates.includes(id)) throw new Error(`Unknown app template: ${id}`);
  for (const name of files.keys()) permitted(name);
  const parse = (name) => {
    if (!files.has(name))
      throw new Error(`Missing template control file: ${name}`);
    return JSON.parse(files.get(name).bytes.toString());
  };
  const selection = parse("app-export.json"),
    manifest = parse("SOURCE_MANIFEST.json");
  if (
    selection.app !== id ||
    selection.profile !== "password-totp-v1" ||
    selection.basePath !== `/${id}` ||
    selection.frontend !== `apps/${id}/frontend` ||
    selection.backend !== `apps/${id}/backend`
  )
    throw new Error("Template app/profile/path mismatch");
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.files ||
    sha(JSON.stringify(manifest.files, null, 2) + "\n") !==
      manifest.snapshotHash
  )
    throw new Error("Template inventory digest mismatch");
  const expected = new Set([
    "SOURCE_MANIFEST.json",
    ".forma-export.complete",
    ...Object.keys(manifest.files),
  ]);
  for (const [name, record] of Object.entries(manifest.files)) {
    safe(name);
    if (!files.has(name) || sha(files.get(name).bytes) !== record.sha256)
      throw new Error(`Template source integrity mismatch: ${name}`);
  }
  if (
    expected.size !== files.size ||
    [...files.keys()].some((name) => !expected.has(name))
  )
    throw new Error("Unexpected template source outside inventory");
  if (
    files.has(".forma-export.pending") ||
    !files.has(".forma-export.complete")
  )
    throw new Error("Template export is incomplete");
  const completion = parse(".forma-export.complete");
  if (completion.schemaVersion !== 1 || completion.app !== id)
    throw new Error("Template completion mismatch");
  const lock = parse("export.lock.json");
  if (lock.app !== id || lock.profile !== "password-totp-v1")
    throw new Error("Template baseline selection mismatch");
  return { files, selection, snapshotHash: manifest.snapshotHash };
}

// A single JSON envelope survives npm's special omission/renaming of nested
// package-lock.json and .gitignore files. Decoded paths still pass full gates.
export async function readBundledTemplate(root, id) {
  if (!templates.includes(id)) throw new Error(`Unknown app template: ${id}`);
  const file = path.join(root, "templates", `${id}.json`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
    throw new Error("Invalid template payload");
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  if (
    payload.schemaVersion !== 1 ||
    payload.template !== id ||
    !Array.isArray(payload.files)
  )
    throw new Error("Invalid template payload header");
  const files = new Map();
  let total = 0;
  for (const entry of payload.files) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string"
    )
      throw new Error("Invalid template payload entry");
    const [name, encoded] = entry;
    permitted(name);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || files.has(name))
      throw new Error("Noncanonical or duplicate template payload entry");
    total += bytes.length;
    if (total > 24 * 1024 * 1024)
      throw new Error("Template decoded payload exceeds limit");
    files.set(name, { bytes, origin: "reviewed-app-export" });
  }
  return validateTemplate(files, id);
}
export function serializeTemplate(template, id) {
  validateTemplate(template.files, id);
  return (
    JSON.stringify({
      schemaVersion: 1,
      template: id,
      files: [...template.files].map(([name, { bytes }]) => [
        name,
        bytes.toString("base64"),
      ]),
    }) + "\n"
  );
}
