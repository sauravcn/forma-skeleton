import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { templates, serializeTemplate } from "../src/templates.mjs";
const fixtureIds = ["customer-alpha", "customer-beta", "seventh-product"];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  assert.equal(
    result.status,
    0,
    `${command} failed: ${(result.stderr || result.error?.message || "").slice(0, 2000)}`,
  );
  return result.stdout;
}
test("actual npm pack and installed bin preserve serialized gitignore/lock bytes for arbitrary advertised templates", async (t) => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "forma-packed-templates-"),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, "source"),
    consumer = path.join(temp, "consumer");
  await fs.mkdir(source);
  await fs.mkdir(consumer);
  for (const name of [
    "package.json",
    "bin",
    "src",
    "assets",
    "bundle",
    "scripts",
    "README.md",
  ])
    await fs.cp(path.join(pkg, name), path.join(source, name), {
      recursive: true,
    });
  await fs.rm(path.join(source, "bundle/templates"), {
    recursive: true,
    force: true,
  });
  await fs.mkdir(path.join(source, "bundle/templates"));
  await fs.writeFile(
    path.join(source, "bundle/templates/catalog.json"),
    JSON.stringify({ schemaVersion: 1, apps: fixtureIds }),
  );
  for (const id of fixtureIds) {
    const files = new Map();
    const add = (name, value) =>
      files.set(name, {
        bytes: Buffer.from(value),
        origin: "synthetic-pack-regression",
      });
    add(
      "app-export.json",
      JSON.stringify({
        app: id,
        profile: "password-totp-v1",
        basePath: `/${id}`,
        frontend: `apps/${id}/frontend`,
        backend: `apps/${id}/backend`,
      }),
    );
    add(
      "export.lock.json",
      JSON.stringify({ app: id, profile: "password-totp-v1" }),
    );
    add(".gitignore", "node_modules/\n.env\n");
    add("package-lock.json", '{"lockfileVersion":3}\n');
    const inventory = Object.fromEntries(
      [...files].map(([name, { bytes }]) => [name, { sha256: sha(bytes) }]),
    );
    add(
      "SOURCE_MANIFEST.json",
      JSON.stringify({
        schemaVersion: 1,
        files: inventory,
        snapshotHash: sha(JSON.stringify(inventory, null, 2) + "\n"),
      }),
    );
    add(
      ".forma-export.complete",
      JSON.stringify({ schemaVersion: 1, app: id }),
    );
    await fs.writeFile(
      path.join(source, "bundle/templates", `${id}.json`),
      serializeTemplate({ files }, id),
    );
  }
  // This isolated package fixture substitutes synthetic domain payloads, so its
  // top-level inventory must honestly describe those fixture bytes as well.
  const provenanceFile = path.join(source, "bundle/provenance.json");
  const provenance = JSON.parse(await fs.readFile(provenanceFile, "utf8"));
  for (const name of Object.keys(provenance.files))
    if (name.startsWith("templates/")) delete provenance.files[name];
  for (const name of await fs.readdir(path.join(source, "bundle/templates")))
    provenance.files["templates/" + name] = sha(
      await fs.readFile(path.join(source, "bundle/templates", name)),
    );
  provenance.snapshotHash = sha(JSON.stringify(provenance.files));
  await fs.writeFile(provenanceFile, JSON.stringify(provenance));
  const packed = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
      source,
    ),
  )[0];
  const tarball = path.join(temp, packed.filename);
  run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    consumer,
  );
  for (const id of fixtureIds) {
    const destination = path.join(temp, "customer-" + id);
    run(
      path.join(consumer, "node_modules/.bin/create-forma-app"),
      [destination, "--template", id, "--yes"],
      consumer,
    );
    assert.equal(
      await fs.readFile(path.join(destination, ".gitignore"), "utf8"),
      "node_modules/\n.env\n",
    );
    assert.equal(
      await fs.readFile(path.join(destination, "package-lock.json"), "utf8"),
      '{"lockfileVersion":3}\n',
    );
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(destination, "app-export.json"), "utf8"),
      ).app,
      id,
    );
  }
  const definition = {
    schemaVersion: 1,
    id: "packed-workspace",
    name: "Packed Workspace",
    nameKey: "packed.name",
    pythonModule: "forma_packed_workspace",
    webPort: 3400,
    apiPort: 9000,
    navigationLayout: "top",
    theme: { name: "custom", tokens: { accent: "#aabbcc" } },
    navigation: [
      { id: "overview", labelKey: "packed.overview", icon: "layers" },
    ],
    labels: {
      "packed.name": "Packed Workspace",
      "packed.overview": "Overview",
    },
  };
  const definitionFile = path.join(consumer, "definition.json"),
    workspace = path.join(temp, "new-workspace");
  await fs.writeFile(definitionFile, JSON.stringify(definition));
  run(
    path.join(consumer, "node_modules/.bin/create-forma-app"),
    [workspace, "--workspace-domain", definitionFile, "--yes"],
    consumer,
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(workspace, "WORKSPACE_BLUEPRINT.json"),
        "utf8",
      ),
    ).status,
    "unfinished-domain",
  );
  assert.match(
    await fs.readFile(
      path.join(workspace, "backend/forma_packed_workspace/repository.py"),
      "utf8",
    ),
    /authorize_operation/,
  );
});
