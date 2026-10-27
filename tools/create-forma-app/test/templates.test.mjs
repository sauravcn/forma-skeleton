import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  readTemplate,
  templates,
  serializeTemplate,
  readBundledTemplate,
} from "../src/templates.mjs";
import { generateTemplate } from "../src/generate-template.mjs";
import { main } from "../bin/create-forma-app.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forma-template-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function mockTemplate(root, id) {
  const folder = path.join(root, "templates", id);
  await fs.mkdir(folder, { recursive: true });
  const files = {
    "app-export.json": JSON.stringify({
      app: id,
      profile: "password-totp-v1",
      basePath: `/${id}`,
      frontend: `apps/${id}/frontend`,
      backend: `apps/${id}/backend`,
    }),
    "export.lock.json": JSON.stringify({
      app: id,
      profile: "password-totp-v1",
    }),
    "README.md": "Customer-owned source\n",
  };
  const inventory = {};
  for (const [name, bytes] of Object.entries(files)) {
    await fs.writeFile(path.join(folder, name), bytes);
    inventory[name] = { sha256: sha(bytes) };
  }
  await fs.writeFile(
    path.join(folder, "SOURCE_MANIFEST.json"),
    JSON.stringify({
      schemaVersion: 1,
      files: inventory,
      snapshotHash: sha(JSON.stringify(inventory, null, 2) + "\n"),
    }),
  );
  await fs.writeFile(
    path.join(folder, ".forma-export.complete"),
    JSON.stringify({ schemaVersion: 1, app: id }),
  );
  await fs.writeFile(
    path.join(root, "templates", `${id}.json`),
    serializeTemplate(await readTemplate(folder, id), id),
  );
  return folder;
}
test("all six bundled template selections preserve complete reviewed source and fixed identity", async (t) => {
  const dir = await fixture(t);
  for (const id of templates) {
    const source = await mockTemplate(dir, id),
      destination = path.join(dir, "customer-" + id);
    const result = await generateTemplate(id, destination, { bundleRoot: dir });
    assert.equal(result.config.app, id);
    for (const name of (await readTemplate(source, id)).files.keys())
      assert.deepEqual(
        await fs.readFile(path.join(destination, name)),
        await fs.readFile(path.join(source, name)),
      );
    await assert.rejects(
      generateTemplate(id, destination, { bundleRoot: dir }),
      /already exists/,
    );
  }
});
test("template validation rejects tampering, inventory extras, private artifacts and symlinks", async (t) => {
  const dir = await fixture(t),
    id = "care-center",
    source = await mockTemplate(dir, id);
  await fs.writeFile(path.join(source, "README.md"), "changed");
  await assert.rejects(readTemplate(source, id), /integrity/);
  await fs.writeFile(path.join(source, "README.md"), "Customer-owned source\n");
  await fs.mkdir(path.join(source, "empty"));
  await fs.writeFile(path.join(source, "unknown.txt"), "extra");
  await assert.rejects(readTemplate(source, id), /outside inventory/);
  await fs.unlink(path.join(source, "unknown.txt"));
  await fs.writeFile(path.join(source, "credentials.json"), "synthetic");
  await assert.rejects(readTemplate(source, id), /Private\/runtime/);
  await fs.unlink(path.join(source, "credentials.json"));
  await fs.symlink(path.join(source, "README.md"), path.join(source, "linked"));
  await assert.rejects(readTemplate(source, id), /symlinks/);
});
test("domain CLI rejects neutral-only overrides and unknown templates before output", async (t) => {
  const dir = await fixture(t),
    destination = path.join(dir, "new");
  const output = { write() {}, isTTY: false },
    input = { isTTY: false };
  for (const flag of [
    "--id",
    "--name",
    "--theme",
    "--navigation",
    "--config",
    "--profile",
  ])
    await assert.rejects(
      main(
        [destination, "--template", "care-center", "--yes", flag, "anything"],
        input,
        output,
      ),
      /cannot be combined/,
    );
  await assert.rejects(
    main([destination, "--template", "unknown", "--yes"], input, output),
    /Unknown app template/,
  );
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
});
test("absent optional catalog fails clearly and dry-run does not reserve destination", async (t) => {
  const dir = await fixture(t),
    destination = path.join(dir, "new");
  await assert.rejects(
    generateTemplate("care-center", destination, { bundleRoot: dir }),
    /not bundled/,
  );
  await mockTemplate(dir, "care-center");
  const result = await generateTemplate("care-center", destination, {
    bundleRoot: dir,
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
  await assert.rejects(
    generateTemplate("care-center", `${dir}/../unsafe`, {
      bundleRoot: dir,
    }),
    /traversal/,
  );
});

test("serialized payload preserves npm-special files and refuses malformed paths/encoding", async (t) => {
  const dir = await fixture(t);
  const id = "care-center";
  await mockTemplate(dir, id);
  const file = path.join(dir, "templates", `${id}.json`);
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  for (const [name, value] of [
    ["../escape", "eA=="],
    ["extra", "noncanonical!"],
  ]) {
    await fs.writeFile(
      file,
      JSON.stringify({
        ...original,
        files: [...original.files, [name, value]],
      }),
    );
    await assert.rejects(readBundledTemplate(dir, id));
  }
});
