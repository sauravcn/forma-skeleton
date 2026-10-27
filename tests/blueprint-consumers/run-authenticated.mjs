/** Release gate: installed CLI -> complete child source -> actual browser identity.
 * Synthetic mail capture travels solely through a private parent/child IPC pipe.
 */
import assert from "node:assert/strict";
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
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "forma-authenticated-consumer-"),
);
const artifacts = path.join(repository, ".run/authenticated-consumer");
await fs.mkdir(artifacts, { recursive: true });
await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify({ complete: false, checks: [], recorded: new Date().toISOString() }));
const environment = {
  ...process.env,
  npm_config_cache:
    process.env.npm_config_cache || path.join(repository, ".run/npm-cache"),
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const key of Object.keys(environment))
  if (
    key === "NODE_PATH" ||
    key === "PYTHONPATH" ||
    key === "INIT_CWD" ||
    key.startsWith("npm_package_") ||
    key.startsWith("npm_lifecycle_") ||
    key.startsWith("FORMA_") ||
    key === "DATABASE_URL" ||
    key === "DATABASE_PATH"
  )
    delete environment[key];
const secrets = new Set();
const logs = [];
const checks = [];
let postgres, browser, service;
let complete = false;
const tasks = new Set();
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    tasks.add(child);
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
    child.once("exit", (code) => {
      clearTimeout(timer);
      tasks.delete(child);
      logs.push(output);
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
  const fixture = path.join(directory, "identity-runner.mjs");
  await fs.copyFile(
    path.join(
      repository,
      "tests/blueprint-consumers/fixtures/identity-runner.mjs",
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
  const messages = [];
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
  child.once("exit", () => {
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
try {
  const tarballs = path.join(directory, "tarballs");
  await fs.mkdir(tarballs);
  const packed = await run(
    "npm",
    ["pack", "--json", "--pack-destination", tarballs],
    path.join(repository, "tools/create-forma-app"),
  );
  const info = JSON.parse(packed.slice(packed.lastIndexOf("\n[") + 1));
  const installed = path.join(directory, "installed");
  await fs.mkdir(installed);
  await fs.writeFile(
    path.join(installed, "package.json"),
    JSON.stringify({ name: "authenticated-cli-consumer", private: true }),
  );
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(tarballs, info[0].filename),
    ],
    installed,
  );
  const config = {
    schemaVersion: 1,
    id: "secure-desk",
    name: "Secure Desk",
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
  const configFile = path.join(directory, "requested.json");
  await fs.writeFile(configFile, JSON.stringify(config));
  const application = path.join(directory, "secure-desk");
  await run(
    "npm",
    [
      "exec",
      "--offline",
      "--",
      "create-forma-app",
      application,
      "--config",
      configFile,
    ],
    installed,
  );
  const files = await inventory(application);
  for (const required of [
    "identity/node/application.mjs",
    "backend-auth/policy.mjs",
    "frontend/src/identity-server.mjs",
    "frontend/src/identity-client.jsx",
    "package-lock.json",
  ])
    assert.ok(files.includes(required), `Missing complete source: ${required}`);
  for (const file of files) {
    assert.ok(
      (path.basename(file) === ".env.example" || !/(^|\/)\.env($|\.)|\.(db|sqlite3?|pem|key)$/.test(file)),
      "No runtime secret/store artifacts",
    );
    if (/\.(mjs|js|jsx|json|py)$/.test(file)) {
      const source = await fs.readFile(path.join(application, file), "utf8");
      assert.ok(
        !source.includes("/workspace/forma-") &&
          !/from\s+["']@forma\//.test(source),
        "No private seller path/package dependency",
      );
    }
  }
  checks.push(
    "installed packed CLI includes independent authenticated source and no seller runtime imports",
  );
  await run("npm", ["ci", "--no-audit", "--no-fund"], application);
  await run("npm", ["test"], application);
  await run("npm", ["run", "build"], application);
  checks.push("generated authenticated npm ci/test/build");
  postgres = await disposablePostgres();
  const port = await freePort();
  let apiPort = await freePort();
  while (apiPort === port) apiPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString("hex");
  secrets.add(secret);
  secrets.add(postgres.databaseUrl);
  const env = {
    FORMA_IDENTITY_DATABASE_URL: postgres.databaseUrl,
    FORMA_AUTH_SECRET: secret,
    FORMA_ORGANIZATION_ID: "synthetic-organization",
    FORMA_PUBLIC_ORIGIN: origin,
    DATABASE_PATH: path.join(directory, "records.sqlite3"),
    API_PORT: String(apiPort),
    WEB_PORT: String(port),
  };
  await startFixture(application, env, true);
  service = await startFixture(application, env);
  checks.push(
    "explicit fresh-store migration and actual child-owned runtime startup",
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.ok(
    new URL(page.url()).pathname.startsWith("/auth"),
    "Protected page redirects unsigned users",
  );
  const missing = await context.request.get(`${origin}/api/records`);
  assert.equal(missing.status(), 401);
  checks.push("unsigned protected page and direct records API deny");
  const password = "Synthetic-consumer-password-47";
  secrets.add(password);
  const credentials = {
    email: "alpha@example.test",
    username: "alpha_consumer",
    name: "Alpha",
    password,
  };
  const heading = (text) =>
    page.getByRole("heading", { name: text, exact: true }).waitFor();
  const continueForm = () =>
    page.getByRole("button", { name: "Continue", exact: true }).click();
  async function login(identifier, value = password) {
    await heading("Sign in");
    await page
      .getByLabel("Email or username", { exact: true })
      .fill(identifier);
    await page.getByLabel("Password", { exact: true }).fill(value);
    await continueForm();
  }
  async function register(user) {
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    for (const field of ["Name", "Username", "Email", "Password"])
      await page
        .getByLabel(field, { exact: true })
        .fill(user[field.toLowerCase()]);
    await continueForm();
    await heading("Verify your email");
    const mail = await service.waitFor(
      (event) =>
        event.type === "mail" &&
        event.message.to === user.email &&
        event.message.kind === "verification",
    );
    assert.equal(new URL(mail.message.url).origin, origin);
    await page.goto(mail.message.url, { waitUntil: "networkidle" });
    await heading("Sign in");
    await login(user.username, user.password);
    await heading("Set up two-factor authentication");
    const pending = await context.request.get(`${origin}/api/records`);
    assert.equal(pending.status(), 403);
    await page
      .getByLabel("Current password", { exact: true })
      .fill(user.password);
    await continueForm();
    await heading("Confirm authenticator setup");
    const encoded = await page.getByLabel("Manual authenticator setup key", {exact: true}).inputValue();
    secrets.add(encoded);
    const key = new TextDecoder().decode(base32.decode(encoded));
    secrets.add(key);
    const otp = createOTP(key);
    const recovery = await page
      .locator(".forma-identity__secrets li code")
      .allTextContents();
    assert.ok(recovery.length > 0);
    recovery.forEach((code) => secrets.add(code));
    const code = await otp.totp();
    secrets.add(code);
    await page.getByLabel("Authentication code", { exact: true }).fill(code);
    await continueForm();
    await page.waitForURL(origin + "/");
    assert.equal(
      (await context.request.get(`${origin}/api/identity`)).status(),
      200,
    );
    return { otp, lastCode: code, recovery };
  }
  const alpha = await register(credentials);
  checks.push(
    "real browser registration, private verification link, password, pending denial and confirmed TOTP enrollment",
  );
  await page.goto(`${origin}/records`, { waitUntil: "networkidle" });
  await page
    .getByLabel("Record title", { exact: true })
    .fill("Private synthetic alpha record");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page
    .getByText("Private synthetic alpha record", { exact: true })
    .waitFor();
  const alphaRecords = await (
    await context.request.get(`${origin}/api/records`)
  ).json();
  const record = alphaRecords.records.find(
    (item) => item.title === "Private synthetic alpha record",
  );
  assert.ok(record);
  const activeCookies = await context.cookies();
  const stolenCookie = activeCookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  secrets.add(stolenCookie);
  await page.screenshot({
    path: path.join(artifacts, "authenticated-records.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await heading("Sign in");
  const revoked = await fetch(`${origin}/api/records`, {
    headers: { Cookie: stolenCookie },
  });
  assert.equal(revoked.status, 401);
  checks.push(
    "browser protected record persistence and server revocation of copied old cookie",
  );
  await login(credentials.email);
  await heading("Two-factor challenge");
  assert.equal(
    (await context.request.get(`${origin}/api/records`)).status(),
    401,
  );
  await page
    .getByRole("button", { name: "Use a recovery code", exact: true })
    .click();
  await page
    .getByLabel("Recovery code", { exact: true })
    .fill(alpha.recovery[0]);
  await continueForm();
  await page.waitForURL(origin + "/");
  checks.push(
    "actual password first-factor challenge and single recovery-code sign-in",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await heading("Sign in");
  const betaCredentials = {
    email: "beta@example.test",
    username: "beta_consumer",
    name: "Beta",
    password,
  };
  await register(betaCredentials);
  const betaList = await (
    await context.request.get(`${origin}/api/records`)
  ).json();
  assert.ok(!betaList.records.some((item) => item.id === record.id));
  const crossOwner = await context.request.patch(
    `${origin}/api/records/${record.id}`,
    {
      headers: { Origin: origin },
      data: { status: "done", expected_revision: 1 },
    },
  );
  assert.ok([403, 404].includes(crossOwner.status()));
  const forgery = await context.request.post(`${origin}/api/records`, {
    headers: { Origin: origin },
    data: {
      title: "forged",
      details: "",
      owner_id: "alpha",
      organization_id: "other",
    },
  });
  assert.equal(forgery.status(), 400);
  checks.push(
    "second real browser identity cannot list/update first owner records or inject ownership",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await heading("Sign in");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await continueForm();
  await page
    .getByRole("status")
    .filter({ hasText: "Check your inbox if eligible." })
    .waitFor();
  const resetMail = await service.waitFor(
    (event) =>
      event.type === "mail" &&
      event.message.to === credentials.email &&
      event.message.kind === "reset",
  );
  await page.goto(resetMail.message.url, { waitUntil: "networkidle" });
  await heading("Choose a new password");
  await page.waitForFunction(
    () => !new URL(window.location.href).searchParams.has("token"),
  );
  const newPassword = "Synthetic-replacement-password-83";
  secrets.add(newPassword);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await continueForm();
  await heading("Sign in");
  await login(credentials.username, newPassword);
  await heading("Two-factor challenge");
  let fresh = await alpha.otp.totp();
  while (fresh === alpha.lastCode) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    fresh = await alpha.otp.totp();
  }
  secrets.add(fresh);
  await page.getByLabel("Authentication code", { exact: true }).fill(fresh);
  await continueForm();
  await page.waitForURL(origin + "/");
  const retained = await (
    await context.request.get(`${origin}/api/records`)
  ).json();
  assert.ok(retained.records.some((item) => item.id === record.id));
  checks.push(
    "real reset link/password replacement, renewed TOTP and retained owner records",
  );
  complete = true;
  console.log("Authenticated installed-consumer browser release checks passed");
} finally {
  await browser?.close();
  for (const child of tasks) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  if (tasks.size) await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of tasks) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  await postgres?.close();
  for (const secret of secrets)
    assert.ok(
      !logs.some((output) => output.includes(secret)),
      "Sensitive token/credential appeared in subprocess output",
    );
  // Only safe operational evidence is persisted; no URLs with tokens/cookies.
  await fs.writeFile(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      { complete, checks, directory, recorded: new Date().toISOString() },
      null,
      2,
    ),
  );
}
