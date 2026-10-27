import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { templates, serializeTemplate } from "../src/templates.mjs";
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
test("actual npm pack and installed bin preserve serialized gitignore/lock bytes for all six templates", async (t) => {
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
  for (const id of templates) {
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
  for (const id of templates) {
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
});
