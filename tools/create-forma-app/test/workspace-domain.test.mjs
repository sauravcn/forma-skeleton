import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  generateWorkspaceDomain,
  validateDefinition,
} from "../src/workspace-domain.mjs";
const definition = {
  schemaVersion: 1,
  id: "sample-domain",
  name: "Sample Domain",
  nameKey: "sample.name",
  pythonModule: "forma_sample_domain",
  webPort: 3200,
  apiPort: 8900,
  navigationLayout: "combined",
  theme: {
    name: "custom",
    tokens: { accent: "#aabbcc", surface: "#ffffff", ink: "#112233" },
  },
  navigation: [{ id: "overview", labelKey: "sample.overview", icon: "layers" }],
  labels: { "sample.name": "Sample Domain", "sample.overview": "Overview" },
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("workspace generation owns source, proposals and reproducible provenance without mutating parent", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "forma-workspace-blueprint-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = path.join(root, "app-one"),
    second = path.join(root, "app-two");
  await generateWorkspaceDomain(definition, first);
  await generateWorkspaceDomain(definition, second);
  const proof = JSON.parse(
    await fs.readFile(path.join(first, "WORKSPACE_BLUEPRINT.json"), "utf8"),
  );
  assert.equal(proof.status, "unfinished-domain");
  assert.equal(proof.blueprint.id, "forma.domain-workspace");
  for (const [name, hash] of Object.entries(proof.files)) {
    assert.equal(sha(await fs.readFile(path.join(first, name))), hash);
    assert.deepEqual(
      await fs.readFile(path.join(first, name)),
      await fs.readFile(path.join(second, name)),
    );
  }
  const proposal = JSON.parse(
    await fs.readFile(path.join(first, "registration.proposal.json"), "utf8"),
  );
  assert.equal(proposal.frontend, "apps/sample-domain/frontend");
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(first, "frontend/src/foundation.manifest.json"),
        "utf8",
      ),
    ).auth,
    "password-totp",
  );
  assert.match(
    await fs.readFile(path.join(first, "frontend/src/main.jsx"), "utf8"),
    /Layers/,
  );
  assert.match(
    await fs.readFile(
      path.join(first, "backend/forma_sample_domain/repository.py"),
      "utf8",
    ),
    /def apply/,
  );
  assert.equal((await fs.readdir(root)).length, 2);
  await assert.rejects(
    generateWorkspaceDomain(definition, first),
    /already exists/,
  );
  const python = spawnSync(
    "python3",
    ["-m", "unittest", "discover", "-s", path.join(first, "backend")],
    { encoding: "utf8" },
  );
  assert.equal(python.status, 0, python.stderr);
});
test("invalid domain definitions and traversal refuse before output; dry run writes nothing", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "forma-workspace-invalid-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, "new");
  for (const patch of [
    { id: "../escape" },
    { pythonModule: "os" },
    { webPort: 8900 },
    { navigationLayout: "floating" },
    {
      navigation: [
        { id: "overview", labelKey: "sample.overview", icon: "unregistered" },
      ],
    },
    {
      theme: {
        name: "unsafe",
        tokens: { accent: "url(https://external.invalid)" },
      },
    },
    { navigation: [{ id: "overview", labelKey: "missing", icon: "layers" }] },
  ])
    await assert.rejects(
      generateWorkspaceDomain({ ...definition, ...patch }, out),
    );
  assert.equal((await fs.readdir(root)).length, 0);
  const plan = await generateWorkspaceDomain(definition, out, { dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.equal((await fs.readdir(root)).length, 0);
  assert.equal(validateDefinition(definition).id, definition.id);
});
