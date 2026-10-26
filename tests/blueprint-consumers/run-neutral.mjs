/** External installed-package proof. No application-repo or seller source imports. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "forma-neutral-consumer-"),
);
const artifactRoot = path.join(repository, ".run", "neutral-consumer");
await fs.mkdir(artifactRoot, { recursive: true });
const env = {
  ...process.env,
  npm_config_cache:
    process.env.npm_config_cache || path.join(repository, ".run", "npm-cache"),
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const key of Object.keys(env)) {
  if (
    key === "PYTHONPATH" ||
    key === "NODE_PATH" ||
    key === "INIT_CWD" ||
    key.startsWith("npm_package_") ||
    key.startsWith("npm_lifecycle_") ||
    key === "npm_config_local_prefix"
  )
    delete env[key];
}
const tasks = [];
function run(command, args, cwd, { background = false, extraEnv = {} } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "",
    stdout = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => (output += chunk));
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(
              `${command} ${args.join(" ")} failed (${code ?? signal}):\n${output.slice(-10000)}`,
            ),
          ),
    );
  });
  if (background) {
    completion.catch(() => {});
    tasks.push(child);
    return {
      child,
      completion,
      get output() {
        return output;
      },
    };
  }
  return completion;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null && !child.signalCode)
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function ready(url, service) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null)
      throw new Error(`Starter exited before readiness:\n${service.output}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Readiness timeout ${url}:\n${service.output}`);
}
async function request(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
try {
  const tarballs = path.join(outputRoot, "tarballs");
  await fs.mkdir(tarballs);
  const packed = await run(
    "npm",
    ["pack", "--json", "--pack-destination", tarballs],
    path.join(repository, "tools/create-forma-app"),
  );
  // prepack may log before npm's JSON payload; select final JSON array.
  const json = JSON.parse(packed.slice(packed.lastIndexOf("\n[") + 1));
  const tarball = path.join(tarballs, json[0].filename);
  const installed = path.join(outputRoot, "installed");
  await fs.mkdir(installed);
  await fs.writeFile(
    path.join(installed, "package.json"),
    JSON.stringify({ name: "forma-consumer-proof", private: true }),
  );
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    installed,
  );
  const cli = path.join(
    installed,
    "node_modules/create-forma-app/bin/create-forma-app.mjs",
  );
  const application = path.join(outputRoot, "neutral-desk");
  await run(
    "npm",
    [
      "exec",
      "--offline",
      "--",
      "create-forma-app",
      application,
      "--yes",
      "--id",
      "neutral-desk",
      "--name",
      "Neutral Desk",
      "--navigation",
      "sidebar",
      "--theme",
      "linen",
    ],
    installed,
  );
  const before = await fs.readFile(
    path.join(application, "app.config.json"),
    "utf8",
  );
  await assert.rejects(
    run(process.execPath, [cli, application, "--yes"], installed),
  );
  assert.equal(
    await fs.readFile(path.join(application, "app.config.json"), "utf8"),
    before,
    "existing output survives rejected regeneration",
  );
  await run(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    application,
  );
  await run("npm", ["test"], application);
  await run("npm", ["run", "build"], application);
  const webPort = await freePort();
  let apiPort = await freePort();
  while (apiPort === webPort) apiPort = await freePort();
  const database = path.join(outputRoot, "synthetic.sqlite");
  const extraEnv = {
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    DATABASE_PATH: database,
  };
  let service = run("npm", ["start"], application, {
    background: true,
    extraEnv,
  });
  await ready(`http://127.0.0.1:${apiPort}/api/health`, service);
  await ready(`http://127.0.0.1:${webPort}/`, service);
  const health = await request(`http://127.0.0.1:${apiPort}/api/health`, "GET");
  assert.equal(health.status, 200);
  const base = `http://127.0.0.1:${webPort}/api/records`;
  const created = await request(base, "POST", {
    title: "Synthetic consumer record",
    details: "External package proof; no real customer data",
  });
  assert.equal(created.status, 201);
  const record = created.body.record || created.body;
  assert.equal(record.revision, 1);
  assert.equal(typeof record.id, "number");
  const updated = await request(`${base}/${record.id}`, "PATCH", {
    status: "done",
    expected_revision: 1,
  });
  assert.equal(updated.status, 200);
  const stale = await request(`${base}/${record.id}`, "PATCH", {
    status: "todo",
    expected_revision: 1,
  });
  assert.equal(stale.status, 409);
  const denied = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.invalid",
    },
    body: JSON.stringify({ title: "Must not create", details: "" }),
  });
  assert.equal(denied.status, 403);
  const html = await fetch(`http://127.0.0.1:${webPort}/`).then((r) =>
    r.text(),
  );
  assert.match(html, /Neutral Desk/);
  await stop(service.child);
  service = run("npm", ["start"], application, { background: true, extraEnv });
  await ready(`http://127.0.0.1:${webPort}/api/records`, service);
  const reloaded = await request(base, "GET");
  const records = reloaded.body.records;
  assert.ok(
    records.some(
      (r) => r.id === record.id && r.status === "done" && r.revision === 2,
    ),
    "synthetic SQLite data persists across supervisor restart",
  );
  await stop(service.child);
  const report = {
    application,
    installed,
    tarball,
    webPort,
    apiPort,
    database,
    checks: [
      "installed tarball generation",
      "destination refusal",
      "independent npm install/test/build/start",
      "HTTP create/update/stale denial",
      "foreign-origin denial",
      "supervised restart persistence",
    ],
  };
  await fs.writeFile(
    path.join(artifactRoot, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all(tasks.map(stop));
}
