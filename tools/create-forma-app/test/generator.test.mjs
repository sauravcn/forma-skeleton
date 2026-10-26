import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  generate,
  readBundle,
  planGeneration,
} from "../src/generate.mjs";
import { configFromAnswers, parseArgs } from "../bin/create-forma-app.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "forma-generator-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "bundle"),
    manifest = {
      schemaVersion: 1,
      id: "forma.application",
      version: "0.1.0",
      compatibleGenerator: "0.1.x",
      requiredModules: [
        "presentation",
        "localization",
        "navigation",
        "records",
      ],
      source: [],
      capabilities: {
        authModes: ["none"],
        providers: [],
        twoFactor: false,
        extensions: false,
      },
      modules: [
        {
          id: "presentation",
          kind: "foundation",
          version: "0.1.0",
          requires: [],
          source: [{ from: "frontend", to: "frontend" }],
        },
        {
          id: "localization",
          kind: "foundation",
          version: "0.1.0",
          requires: ["presentation"],
          source: [],
        },
        {
          id: "navigation",
          kind: "foundation",
          version: "0.1.0",
          requires: ["localization"],
          source: [],
        },
        {
          id: "records",
          kind: "domain",
          version: "0.1.0",
          requires: ["navigation"],
          source: [{ from: "backend", to: "backend" }],
        },
      ],
    };
  const source = {
    "blueprint/blueprint.json": JSON.stringify(manifest),
    "blueprint/frontend/package.json": JSON.stringify({
      name: "fixture",
      private: true,
      scripts: { test: "node --test" },
      dependencies: { next: "16.4.2", react: "19.3.1", "react-dom": "19.3.1" },
    }),
    "blueprint/frontend/src/example.mjs":
      'export const source = "complete local source";\n',
    "blueprint/backend/server.py": 'print("synthetic local backend")\n',
  };
  for (const [relative, content] of Object.entries(source)) {
    const file = path.join(dir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  await fs.cp(path.join(packageRoot, "assets"), path.join(dir, "assets"), {
    recursive: true,
  });
  async function pin() {
    const files = {};
    async function scan(folder) {
      for (const name of (await fs.readdir(folder)).sort()) {
        const full = path.join(folder, name),
          s = await fs.lstat(full);
        if (s.isDirectory()) await scan(full);
        else
          files[path.relative(dir, full).split(path.sep).join("/")] = sha(
            await fs.readFile(full),
          );
      }
    }
    await scan(path.join(dir, "blueprint"));
    await scan(path.join(dir, "assets"));
    await fs.writeFile(
      path.join(dir, "provenance.json"),
      JSON.stringify({
        repository: "synthetic-fixture",
        revision: null,
        dirty: true,
        snapshotHash: sha(JSON.stringify(files)),
        files,
      }),
    );
  }
  await pin();
  return {
    root,
    dir,
    manifest,
    pin,
    bundle: () => readBundle(dir),
    output: path.join(root, "new-app"),
  };
}
test("interactive answers and noninteractive flags share one validated output", async (t) => {
  const f = await fixture(t),
    explicit = await configFromAnswers(
      {
        destination: f.output,
        yes: true,
        id: "sample-app",
        name: "Sample App",
        navigation: "combined",
        theme: "midnight",
      },
      () => {
        throw new Error("Unexpected prompt");
      },
    );
  const answers = [
    f.output,
    "sample-app",
    "Sample App",
    "combined",
    "midnight",
  ];
  const interactive = await configFromAnswers({}, async () => answers.shift());
  assert.deepEqual(interactive, explicit);
  const first = await planGeneration(explicit.config, f.output, {
      bundle: await f.bundle(),
    }),
    second = await planGeneration(
      interactive.config,
      path.join(f.root, "second"),
      { bundle: await f.bundle() },
    );
  assert.deepEqual(
    [...first.files].map(([k, v]) => [k, v.bytes.toString()]),
    [...second.files].map(([k, v]) => [k, v.bytes.toString()]),
  );
});
test("output includes complete declared source and verified app-local provenance", async (t) => {
  const f = await fixture(t),
    result = await generate(defaultConfig(), f.output, {
      bundle: await f.bundle(),
    });
  assert.equal(result.config.auth.mode, "none");
  const environment = await fs.readFile(
    path.join(f.output, ".env.example"),
    "utf8",
  );
  assert.deepEqual(
    environment
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]),
    ["WEB_PORT", "API_PORT", "DATABASE_PATH", "PYTHON_BIN"],
  );
  assert.ok(
    (await fs.readFile(path.join(f.output, "README.md"), "utf8")).startsWith(
      "# Sample App\n",
    ),
  );
  assert.equal(
    (
      await fs.readFile(path.join(f.output, "frontend/src/example.mjs"), "utf8")
    ).includes("local source"),
    true,
  );
  assert.match(
    await fs.readFile(path.join(f.output, "AGENTS.md"), "utf8"),
    /No coding agent is automatically installed or running/,
  );
  const api = JSON.parse(
    await fs.readFile(
      path.join(f.output, "contracts/records.openapi.json"),
      "utf8",
    ),
  );
  assert.equal(api.openapi, "3.1.0");
  assert.equal(
    api.paths["/api/records/{id}"].patch.operationId,
    "transitionSyntheticRecord",
  );
  assert.deepEqual(api.security, []);
  const manifest = JSON.parse(
    await fs.readFile(path.join(f.output, "SOURCE_MANIFEST.json"), "utf8"),
  );
  for (const [file, entry] of Object.entries(manifest.files))
    assert.equal(
      sha(await fs.readFile(path.join(f.output, file))),
      entry.sha256,
      file,
    );
  assert.equal(manifest.excludesSelf, true);
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(f.output, "frontend/package.json"), "utf8"),
    ).name,
    "@sample-app/frontend",
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(f.output, ".forma-generation.json"), "utf8"),
    ).state,
    "complete",
  );
  await assert.rejects(
    fs.lstat(path.join(f.output, ".forma-generation.pending")),
    /ENOENT/,
  );
  const lock = JSON.parse(
    await fs.readFile(path.join(f.output, "blueprint.lock.json"), "utf8"),
  );
  assert.equal(lock.source.dirty, true);
  assert.equal(lock.source.repository, "synthetic-fixture");
  assert.equal(lock.modules.length, 4);
});
test("unsupported auth unknown args and unsafe destination fail before output", async (t) => {
  const f = await fixture(t),
    config = defaultConfig();
  config.auth = { mode: "password", providers: [], twoFactor: false };
  await assert.rejects(
    generate(config, f.output, { bundle: await f.bundle() }),
    /not implemented/,
  );
  await assert.rejects(
    generate(
      defaultConfig(),
      path.join(f.root, "missing-parent", "traversal"),
      { bundle: await f.bundle() },
    ),
    /ENOENT/,
  );
  await assert.rejects(
    generate(defaultConfig(), f.root + "/../traversal", {
      bundle: await f.bundle(),
    }),
    /traversal/,
  );
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);
  assert.throws(() => parseArgs(["--id"]), /Expected a value/);
  await assert.rejects(fs.lstat(f.output), /ENOENT/);
});
test("existing directories and dangling destination symlinks are preserved", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.output);
  await fs.writeFile(path.join(f.output, "owner.txt"), "keep original");
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle: await f.bundle() }),
    /already exists/,
  );
  assert.equal(
    await fs.readFile(path.join(f.output, "owner.txt"), "utf8"),
    "keep original",
  );
  const link = path.join(f.root, "dangling");
  await fs.symlink(path.join(f.root, "missing"), link);
  await assert.rejects(
    generate(defaultConfig(), link, { bundle: await f.bundle() }),
    /already exists/,
  );
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
});
test("source symlinks excluded artifacts and changed or unpinned source are refused", async (t) => {
  const f = await fixture(t),
    bundle = await f.bundle(),
    file = path.join(f.dir, "blueprint/frontend/src/example.mjs");
  await fs.writeFile(file, "changed");
  await assert.rejects(f.bundle(), /integrity/);
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle }),
    /changed source/,
  );
  await fs.writeFile(file, 'export const source = "complete local source";\n');
  await fs.writeFile(
    path.join(f.dir, "blueprint/frontend/src/new.mjs"),
    "unrecorded",
  );
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle }),
    /Unpinned/,
  );
  await fs.unlink(path.join(f.dir, "blueprint/frontend/src/new.mjs"));
  await fs.symlink(file, path.join(f.dir, "blueprint/frontend/src/link.mjs"));
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle }),
    /symlink/,
  );
  await fs.unlink(path.join(f.dir, "blueprint/frontend/src/link.mjs"));
  await fs.writeFile(
    path.join(f.dir, "blueprint/frontend/.env"),
    "synthetic secret marker",
  );
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle }),
    /Excluded/,
  );
  await assert.rejects(fs.lstat(f.output), /ENOENT/);
});
test("case-colliding files and root asset collisions fail without writes", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.dir, "blueprint/frontend/src/EXAMPLE.mjs"),
    "case collision",
  );
  await f.pin();
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle: await f.bundle() }),
    /collision/,
  );
  await fs.unlink(path.join(f.dir, "blueprint/frontend/src/EXAMPLE.mjs"));
  await f.pin();
  const bundle = await f.bundle();
  bundle.manifest.source = [{ from: "backend/server.py", to: "package.json" }];
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle }),
    /collision/,
  );
  await assert.rejects(fs.lstat(f.output), /ENOENT/);
});
test("dry run is read-only and concurrent generation has exactly one winner", async (t) => {
  const f = await fixture(t),
    bundle = await f.bundle(),
    before = (await fs.readdir(f.root)).sort();
  const dry = await generate(defaultConfig(), f.output, {
    bundle,
    dryRun: true,
  });
  assert.equal(dry.dryRun, true);
  assert.deepEqual((await fs.readdir(f.root)).sort(), before);
  const results = await Promise.allSettled([
    generate(defaultConfig(), f.output, { bundle }),
    generate(defaultConfig(), f.output, { bundle }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(f.output, ".forma-generation.json"), "utf8"),
    ).state,
    "complete",
  );
  await assert.rejects(
    fs.lstat(path.join(f.output, ".forma-generation.pending")),
    /ENOENT/,
  );
  assert.equal(
    (await fs.readdir(f.root)).some((name) => name.includes(".forma-stage-")),
    false,
  );
});
test("post-reservation failure leaves explicit pending state and refuses retry", async (t) => {
  const f = await fixture(t),
    bundle = await f.bundle(),
    rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to.startsWith(f.output + path.sep))
      throw Object.assign(new Error("synthetic write failure"), {
        code: "EIO",
      });
    return rename(from, to);
  };
  try {
    await assert.rejects(
      generate(defaultConfig(), f.output, { bundle }),
      /incomplete generation/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.ok(
    await fs.readFile(path.join(f.output, ".forma-generation.pending"), "utf8"),
  );
  await assert.rejects(
    generate(defaultConfig(), f.output, { bundle }),
    /already exists/,
  );
  assert.equal(
    (await fs.readdir(f.root)).some((name) => name.includes(".forma-stage-")),
    false,
  );
});
test("CLI non-TTY contract rejects missing input without creating a default project", async (t) => {
  const f = await fixture(t),
    cli = path.join(packageRoot, "bin/create-forma-app.mjs");
  const result = spawnSync(process.execPath, [cli], {
    cwd: f.root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /destination|Noninteractive/);
  assert.equal((await fs.readdir(f.root)).includes("sample-app"), false);
  const help = spawnSync(process.execPath, [cli, "--help"], {
    cwd: f.root,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /public synthetic/);
});

test("npm-style bin symlink invokes generation and preserves literal display-name replacements", async (t) => {
  const f = await fixture(t),
    bin = path.join(f.root, "node_modules/.bin");
  await fs.mkdir(bin, { recursive: true });
  const executable = path.join(bin, "create-forma-app");
  await fs.symlink(
    path.join(packageRoot, "bin/create-forma-app.mjs"),
    executable,
  );
  const output = path.join(f.root, "symlink-app"),
    name = "Sample $& App";
  const result = spawnSync(
    executable,
    [output, "--yes", "--id", "symlink-proof", "--name", name],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).config.name, name);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(output, "app.config.json"), "utf8"))
      .id,
    "symlink-proof",
  );
  assert.ok(
    (await fs.readFile(path.join(output, "README.md"), "utf8")).startsWith(
      "# " + name + "\n",
    ),
  );
});
