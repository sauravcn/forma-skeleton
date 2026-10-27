/** Release gate: installed CLI -> complete child source -> actual browser identity.
 * Synthetic mail capture travels solely through a private parent/child IPC pipe.
 */
import assert from "node:assert/strict";
import { en } from "../../blueprints/application/modules/identity-ui/src/en.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { chromium } from "playwright";
import { disposablePostgres } from "./fixtures/disposable-postgres.mjs";
import {
  observeClose,
  stopOwnedChildren,
  portIsOpen,
  safeFailureKind,
} from "./fixtures/consumer-safety.mjs";
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "forma-mock-social-consumer-"),
);
const artifacts = path.join(repository, ".run/mock-social-consumer");
await fs.mkdir(artifacts, { recursive: true });
await fs.writeFile(
  path.join(artifacts, "report.json"),
  JSON.stringify({
    complete: false,
    checks: [],
    recorded: new Date().toISOString(),
  }),
);
const environment = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "COMSPEC",
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
environment.npm_config_cache =
  process.env.npm_config_cache || path.join(repository, ".run/npm-cache");
environment.NEXT_TELEMETRY_DISABLED = "1";
environment.npm_config_userconfig = path.join(directory, "empty.npmrc");
await fs.writeFile(environment.npm_config_userconfig, "", { mode: 0o600 });
const networkEnvironment = Object.fromEntries(
  [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
const secrets = new Set();
const logs = [];
const checks = [];
let postgres, browser, service;
let complete = false;
let failure;
let commandFailure;
const ownedPorts = new Set();
const tasks = new Set();
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...environment, ...networkEnvironment },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    tasks.add(child);
    observeClose(child);
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 180000);
    child.once("error", (error) => {
      clearTimeout(timer);
      tasks.delete(child);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      tasks.delete(child);
      logs.push(output);
      if (code !== 0)
        commandFailure = {
          command: path.basename(command),
          exitCode: code,
          npmCode:
            output.match(/(?:npm (?:error|ERR!) code) ([A-Z0-9_]+)/)?.[1] ||
            null,
        };
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${command} failed; output withheld pending secret audit`,
            ),
          );
    });
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function startFixture(projectRoot, env, migrate = false) {
  const fixture = path.join(directory, "mock-social-runner.mjs");
  await fs.copyFile(
    path.join(
      repository,
      "tests/blueprint-consumers/fixtures/mock-social-runner.mjs",
    ),
    fixture,
  );
  const child = fork(fixture, [projectRoot], {
    cwd: projectRoot,
    env: { ...environment, ...env, FORMA_FIXTURE_MIGRATE: migrate ? "1" : "0" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  tasks.add(child);
  observeClose(child);
  const messages = [];
  child.once("error", () =>
    messages.push({ type: "failure", name: "ProcessError" }),
  );
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  child.on("message", (message) => {
    messages.push(message);
    if (message.type === "mail")
      for (const field of ["token", "url"])
        if (message.message[field]) secrets.add(message.message[field]);
  });
  child.once("close", () => {
    tasks.delete(child);
    logs.push(output);
  });
  const waitFor = async (predicate, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const message = messages.find(predicate);
      if (message) return message;
      if (
        messages.some((message) => message.type === "failure") ||
        child.exitCode !== null
      )
        throw new Error(
          "Generated identity fixture failed; raw errors withheld to protect credentials",
        );
      if (Date.now() >= deadline)
        throw new Error("Generated identity fixture timeout");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  await waitFor((message) => message.type === (migrate ? "migrated" : "ready"));
  return { child, messages, waitFor };
}
async function inventory(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(root, entry.name);
    assert.ok(
      !entry.isSymbolicLink(),
      "Generated source cannot link back to seller checkout",
    );
    if (entry.isDirectory())
      for (const item of await inventory(full))
        files.push(path.join(entry.name, item));
    else files.push(entry.name);
  }
  return files;
}
let phase = "prepare";
async function checkpoint(next) {
  phase = next;
  await fs.writeFile(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      { complete: false, phase, checks, recorded: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
}
try {
  let tarball = process.env.FORMA_CONSUMER_CLI_TARBALL;
  if (tarball) {
    tarball = path.resolve(tarball);
    const stat = await fs.lstat(tarball);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
  } else {
    const tarballs = path.join(directory, "tarballs");
    await fs.mkdir(tarballs);
    await checkpoint("pack-cli");
    const packed = await run(
      "npm",
      ["pack", "--json", "--pack-destination", tarballs],
      path.join(repository, "tools/create-forma-app"),
    );
    const info = JSON.parse(packed.slice(packed.lastIndexOf("\n[") + 1));
    tarball = path.join(tarballs, info[0].filename);
    console.log(
      "Canonical mock consumer pack complete; shared builder released",
    );
  }
  const installed = path.join(directory, "installed");
  await fs.mkdir(installed);
  await fs.writeFile(
    path.join(installed, "package.json"),
    JSON.stringify({ name: "mock-social-consumer", private: true }),
  );
  await checkpoint("install-cli");
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    installed,
  );
  const config = {
    schemaVersion: 1,
    id: "mock-desk",
    name: "Mock Desk",
    modules: [
      "presentation",
      "localization",
      "navigation",
      "records",
      "identity",
      "records-auth",
    ],
    navigation: { layout: "combined" },
    theme: { preset: "midnight", tokens: {} },
    auth: { mode: "password", providers: [], twoFactor: true },
    locale: "en-US",
    extensions: [],
  };
  const requested = path.join(directory, "requested.json");
  await fs.writeFile(requested, JSON.stringify(config));
  const application = path.join(directory, "mock-desk");
  await checkpoint("generate");
  await run(
    "npm",
    [
      "exec",
      "--offline",
      "--",
      "create-forma-app",
      application,
      "--config",
      requested,
    ],
    installed,
  );
  for (const file of [
    "identity/core/lifecycle/src/mock-oauth.mjs",
    "identity/core/lifecycle/src/mock-messages.en-US.json",
    "identity/node/application.mjs",
    "identity/frontend/social-contract.mjs",
  ])
    assert.ok((await inventory(application)).includes(file));
  checks.push(
    "packed and installed CLI generated complete physical mock/auth source outside seller checkout",
  );
  await checkpoint("install-test-build");
  await run("npm", ["ci", "--no-audit", "--no-fund"], application);
  await run("npm", ["test"], application);
  await run("npm", ["run", "build"], application);
  checks.push(
    "independent generated npm ci/test and optimized build (mock runtime remains development only)",
  );
  postgres = await disposablePostgres();
  const web = await freePort();
  let api = await freePort();
  while (api === web) api = await freePort();
  ownedPorts.add(web);
  ownedPorts.add(api);
  const origin = `http://127.0.0.1:${web}`,
    secret = randomBytes(32).toString("hex");
  secrets.add(secret);
  secrets.add(postgres.databaseUrl);
  const env = {
    NODE_ENV: "development",
    FORMA_ENVIRONMENT: "local",
    FORMA_MOCK_OAUTH: "1",
    FORMA_IDENTITY_DATABASE_URL: postgres.databaseUrl,
    FORMA_AUTH_SECRET: secret,
    FORMA_ORGANIZATION_ID: "synthetic-mock-organization",
    FORMA_PUBLIC_ORIGIN: origin,
    DATABASE_PATH: path.join(directory, "records.sqlite3"),
    API_PORT: String(api),
    WEB_PORT: String(web),
  };
  await checkpoint("migrate-start");
  await startFixture(application, env, true);
  service = await startFixture(application, env);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext(),
    page = await context.newPage();
  const errors = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    for (const name of ["state", "code", "token"])
      if (url.searchParams.has(name)) {
        secrets.add(url.searchParams.get(name));
        secrets.add(url.href);
      }
  });
  page.on("pageerror", (error) => errors.push(safeFailureKind(error)));
  async function cookies() {
    for (const value of await context.cookies()) {
      secrets.add(value.value);
      secrets.add(`${value.name}=${value.value}`);
    }
  }
  async function heading(name) {
    await page.getByRole("heading", { name, exact: true }).waitFor();
    await cookies();
  }
  const proceed = () =>
    page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.goto(origin, { waitUntil: "networkidle" });
  await heading("Sign in");
  assert.equal(
    (await context.request.get(origin + "/api/records")).status(),
    401,
  );
  assert.equal(
    (await context.request.get(`http://127.0.0.1:${api}/api/records`)).status(),
    401,
  );
  let socialStarts = 0,
    lastSocialStart = 0;
  async function startSocial(brand) {
    if (socialStarts >= 3 && Date.now() - lastSocialStart < 11500)
      await page.waitForTimeout(11500 - (Date.now() - lastSocialStart));
    if (Date.now() - lastSocialStart >= 11000) socialStarts = 0;
    const response = page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === "/api/auth/sign-in/social" &&
        result.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: `Continue with ${brand} (MOCK)`,
        exact: true,
      })
      .click();
    assert.equal((await response).status(), 200);
    socialStarts++;
    lastSocialStart = Date.now();
  }
  await checkpoint("five-cancel");
  for (const [id, brand] of [
    ["google", "Google"],
    ["facebook", "Facebook"],
    ["github", "GitHub"],
    ["microsoft", "Microsoft"],
    ["apple", "Apple"],
  ]) {
    await startSocial(brand);
    await heading(`${brand} MOCK sign-in`);
    assert.equal(new URL(page.url()).pathname, `/__mock-oauth/${id}/authorize`);
    await page
      .getByRole("button", { name: "Cancel MOCK sign-in", exact: true })
      .click();
    await heading("Sign in");
    await page
      .getByRole("status")
      .filter({
        hasText: en.socialCancelled,
      })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, "/auth");
    assert.equal(new URL(page.url()).search, "");
    assert.equal(
      (await context.request.get(origin + "/api/records")).status(),
      401,
    );
  }
  checks.push(
    "actual browser five MOCK provider redirects/cancel paths return safely without account or domain access",
  );
  await page.screenshot({
    path: path.join(artifacts, "mock-login-desktop.png"),
    fullPage: true,
  });
  await checkpoint("google-password-factor");
  await startSocial("Google");
  await heading("Google MOCK sign-in");
  await page
    .getByLabel("Synthetic account", { exact: true })
    .selectOption("primary");
  await page
    .getByRole("button", { name: "Approve MOCK sign-in", exact: true })
    .click();
  await heading(en.setPassword);
  const password = "Synthetic-canonical-mock-password-68";
  secrets.add(password);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await proceed();
  await heading("Set up two-factor authentication");
  assert.equal(
    (await context.request.get(origin + "/api/records")).status(),
    403,
  );
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await proceed();
  await heading("Confirm authenticator setup");
  const encoded = await page
    .getByLabel("Manual authenticator setup key", { exact: true })
    .inputValue();
  secrets.add(encoded);
  const key = new TextDecoder().decode(base32.decode(encoded));
  secrets.add(key);
  const otp = createOTP(key);
  const recovery = await page
    .locator(".forma-identity__secrets li code")
    .allTextContents();
  assert.ok(recovery.length > 0);
  recovery.forEach((value) => secrets.add(value));
  const code = await otp.totp();
  secrets.add(code);
  await page.getByLabel("Authentication code", { exact: true }).fill(code);
  await proceed();
  await page
    .getByRole("alert")
    .filter({
      hasText: en.forbidden,
    })
    .waitFor();
  assert.equal(
    (await context.request.get(origin + "/api/records")).status(),
    403,
  );
  const unverifiedPassword = "Synthetic-unverified-operator-check-39";
  secrets.add(unverifiedPassword);
  const unverified = await context.request.post(
    origin + "/api/auth/sign-up/email",
    {
      headers: { Origin: origin },
      data: {
        email: "unverified@synthetic.test",
        username: "unverified_mock",
        name: "Synthetic Unverified",
        password: unverifiedPassword,
      },
    },
  );
  assert.equal(unverified.status(), 200);
  service.child.send({ type: "operator-reject" });
  await service.waitFor((message) => message.type === "operator-rejected");
  assert.equal(
    (await context.request.get(origin + "/api/records")).status(),
    403,
  );
  service.child.send({ type: "operator-approve" });
  await service.waitFor((message) => message.type === "operator-approved");
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.goto(origin + "/records", { waitUntil: "networkidle" });
  await cookies();
  await page
    .getByLabel("Record title", { exact: true })
    .fill("Synthetic mock-owned record");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page
    .getByText("Synthetic mock-owned record", { exact: true })
    .waitFor();
  const response = await context.request.get(origin + "/api/records");
  assert.equal(response.status(), 200);
  const record = (await response.json()).records.find(
    (row) => row.title === "Synthetic mock-owned record",
  );
  assert.ok(record);
  const direct = await context.request.get(
    `http://127.0.0.1:${api}/api/records`,
  );
  assert.equal(direct.status(), 200);
  checks.push(
    "Google maintained callback, password setup, real TOTP and unapproved403 precede explicit trusted operator bootstrap and persistent direct/proxied records",
  );
  await checkpoint("oauth-return-stepup");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await heading("Sign in");
  await startSocial("Google");
  await heading("Google MOCK sign-in");
  await page
    .getByRole("button", { name: "Approve MOCK sign-in", exact: true })
    .click();
  await heading("Two-factor challenge");
  assert.equal(
    (await context.request.get(origin + "/api/records")).status(),
    403,
  );
  await page
    .getByRole("button", { name: "Use a recovery code", exact: true })
    .click();
  await heading(en.recovery);
  await page.getByLabel("Recovery code", { exact: true }).fill(recovery[0]);
  await proceed();
  await page.waitForURL(origin + "/");
  await cookies();
  assert.equal(
    (await context.request.get(origin + "/api/records")).status(),
    200,
  );
  const copied = (await context.cookies())
    .map((value) => `${value.name}=${value.value}`)
    .join("; ");
  secrets.add(copied);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await heading("Sign in");
  assert.equal(
    (
      await context.request.get(origin + "/api/records", {
        headers: { Cookie: copied },
      })
    ).status(),
    401,
  );
  checks.push(
    "returning OAuth remains basic and denies records until factor; maintained recovery succeeds and logout revokes copied session",
  );
  assert.deepEqual(errors, []);
  await cookies();
  complete = true;
} catch (error) {
  failure = safeFailureKind(error);
  complete = false;
} finally {
  try {
    await browser?.close();
  } catch {
    failure ||= "BrowserCleanupError";
  }
  try {
    await stopOwnedChildren(tasks);
  } catch {
    failure ||= "ProcessCleanupError";
  }
  for (const port of ownedPorts)
    if (await portIsOpen(port)) failure ||= "PortCleanupError";
  try {
    await postgres?.close();
  } catch {
    failure ||= "DatabaseCleanupError";
  }
  for (const value of secrets)
    if (value && logs.some((output) => output.includes(value)))
      failure ||= "SensitiveOutputError";
  try {
    await fs.rm(directory, { recursive: true, force: true });
  } catch {
    failure ||= "TempCleanupError";
  }
  complete = complete && !failure;
  await fs.writeFile(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      {
        complete,
        failure,
        phase,
        commandFailure,
        checks,
        scope:
          "installed canonical generated starter with local MOCK OAuth; no real provider/production acceptance",
        recorded: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}
if (!complete) {
  console.error(
    `Canonical MOCK browser proof failed (${failure || "Error"}) at ${phase}; private raw diagnostics withheld`,
  );
  process.exitCode = 1;
} else
  console.log(
    "Canonical installed mock OAuth browser proof passed after cleanup and output-secret audit",
  );
