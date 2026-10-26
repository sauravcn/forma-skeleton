/** Keyboard/nested-menu proof against the latest installed generated synthetic app. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const artifacts = path.join(repository, ".run", "neutral-consumer");
const report = JSON.parse(
  await fs.readFile(path.join(artifacts, "report.json"), "utf8"),
);
const application = await fs.realpath(report.application);
const temporaryRoot = await fs.realpath(os.tmpdir());
assert.ok(
  application.startsWith(temporaryRoot + path.sep),
  "navigation proof must use the generated temporary consumer, never seller/customer source",
);
const marker = JSON.parse(
  await fs.readFile(path.join(application, ".forma-generation.json"), "utf8"),
);
assert.equal(marker.state, "complete");
const configFile = path.join(application, "app.config.json"),
  manifestFile = path.join(
    application,
    "frontend/src/navigation.manifest.json",
  );
const originalConfig = await fs.readFile(configFile, "utf8"),
  originalManifest = await fs.readFile(manifestFile, "utf8");
const config = JSON.parse(originalConfig),
  manifest = JSON.parse(originalManifest);
assert.equal(config.auth.mode, "none");
assert.equal(config.auth.providers.length, 0);
assert.equal(config.auth.twoFactor, false);
const work = await fs.mkdtemp(
  path.join(os.tmpdir(), "forma-navigation-proof-"),
);
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  npm_config_cache:
    process.env.npm_config_cache || path.join(repository, ".run", "npm-cache"),
};
for (const key of Object.keys(env))
  if (
    key === "PYTHONPATH" ||
    key === "NODE_PATH" ||
    key === "INIT_CWD" ||
    key.startsWith("npm_package_") ||
    key.startsWith("npm_lifecycle_") ||
    key === "npm_config_local_prefix"
  )
    delete env[key];
let active = null;
function command(args, background = false, extra = {}) {
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: application,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let output = "";
  child.stdout.on("data", (c) => (output = (output + c).slice(-15000)));
  child.stderr.on("data", (c) => (output = (output + c).slice(-15000)));
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `npm ${args.join(" ")} failed (${code ?? signal}): ${output}`,
            ),
          ),
    );
  });
  if (background) {
    completion.catch(() => {});
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
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function isOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
async function stop() {
  if (!active) return;
  const running = active;
  active = null;
  if (running.child.exitCode === null && !running.child.signalCode) {
    try {
      if (process.platform !== "win32")
        process.kill(-running.child.pid, "SIGTERM");
      else running.child.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await Promise.race([
    new Promise((resolve) =>
      running.child.exitCode !== null || running.child.signalCode
        ? resolve()
        : running.child.once("exit", resolve),
    ),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);
  if (running.child.exitCode === null && !running.child.signalCode) {
    try {
      if (process.platform !== "win32")
        process.kill(-running.child.pid, "SIGKILL");
      else running.child.kill("SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await isOpen(running.web)) && !(await isOpen(running.api))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Navigation proof left a managed service port open");
}
async function start() {
  const web = await freePort();
  let api = await freePort();
  while (api === web) api = await freePort();
  active = {
    ...command(["start"], true, {
      WEB_PORT: String(web),
      API_PORT: String(api),
      DATABASE_PATH: path.join(work, "synthetic.sqlite"),
    }),
    web,
    api,
  };
  const url = `http://127.0.0.1:${web}`;
  for (let attempt = 0; attempt < 160; attempt++) {
    if (active.child.exitCode !== null || active.child.signalCode)
      throw new Error(active.output);
    try {
      const response = await fetch(url + "/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const value = await response.json();
        assert.equal(value.mode, "public-synthetic");
        assert.equal(value.authentication, "none");
        return url;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Navigation proof startup failed: " + active.output);
}
async function focused(page, locator) {
  await page.waitForFunction(
    (element) => element === document.activeElement,
    await locator.elementHandle(),
  );
}
async function mainFocused(page) {
  await page.waitForFunction(
    () => document.activeElement?.id === "main-content",
  );
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "no page-wide horizontal overflow",
  );
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const [layout, preset] of [
    ["sidebar", "linen"],
    ["top", "midnight"],
    ["combined", "linen"],
  ]) {
    await stop();
    const selected = structuredClone(config);
    selected.navigation.layout = layout;
    selected.theme.preset = preset;
    const nested = structuredClone(manifest);
    const parent = nested.items.find((item) => item.id === "overview"),
      child = nested.items.find((item) => item.id === "records");
    assert.ok(
      parent && child,
      "proof requires the neutral default route identities",
    );
    child.parent = parent.id;
    child.group = parent.group;
    await fs.writeFile(configFile, JSON.stringify(selected, null, 2) + "\n");
    await fs.writeFile(manifestFile, JSON.stringify(nested, null, 2) + "\n");
    await command(["run", "build"]);
    const url = await start();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url + "/");
    await page
      .locator(".connection")
      .getByText("API connected", { exact: true })
      .waitFor();
    const region = page.locator(
      layout === "top" ? ".top-navigation" : ".app-sidebar",
    );
    const overview = region.locator('[data-navigation-id="overview"]'),
      records = region.locator('[data-navigation-id="records"]');
    await overview.waitFor();
    assert.equal(await overview.getAttribute("aria-current"), "page");
    await overview
      .locator("xpath=..")
      .locator(':scope > ul [data-navigation-id="records"]')
      .waitFor({ state: "visible" });
    await records.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(url + "/records");
    await mainFocused(page);
    assert.equal(
      await region
        .locator('[data-navigation-id="records"]')
        .getAttribute("aria-current"),
      "page",
    );
    await noOverflow(page);
    await page.screenshot({
      path: path.join(artifacts, `navigation-${layout}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    assert.equal(
      await trigger.getAttribute("aria-controls"),
      "mobile-navigation",
    );
    assert.equal(await trigger.getAttribute("aria-haspopup"), "dialog");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Main navigation",
      exact: true,
    });
    await dialog.waitFor({ state: "visible" });
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    const close = dialog.getByRole("button", {
      name: "Close navigation",
      exact: true,
    });
    await focused(page, close);
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let index = 0; index < 9; index++) {
        await page.keyboard.press(key);
        assert.equal(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          true,
          "focus remains inside named modal",
        );
      }
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await focused(page, trigger);
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await page.keyboard.press("Space");
    await dialog.waitFor({ state: "visible" });
    await close.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "hidden" });
    await focused(page, trigger);
    for (const route of ["overview", "records", "records"]) {
      await trigger.focus();
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "visible" });
      const link = dialog.locator(`[data-navigation-id="${route}"]`);
      await link.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(url + (route === "overview" ? "/" : "/records"));
      await dialog.waitFor({ state: "hidden" });
      await mainFocused(page);
      assert.equal(
        await page
          .locator(`#mobile-navigation [data-navigation-id="${route}"]`)
          .getAttribute("aria-current"),
        "page",
      );
    }
    await noOverflow(page);
    await page.locator(".development-notice").waitFor({ state: "visible" });
    assert.match(
      await page.locator(".development-notice").innerText(),
      /authentication is not enabled/,
    );
    await page.screenshot({
      path: path.join(artifacts, `navigation-${layout}-mobile.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.close();
    results.push({
      layout,
      preset,
      checks: [
        "actual nested manifest render",
        "desktop keyboard route and active marker",
        "named dialog and trigger linkage",
        "Enter/Space open",
        "Tab/ShiftTab containment",
        "Escape/explicit-close trigger focus",
        "different/same-route main focus",
        "mobile overflow",
        "no browser page errors",
      ],
    });
    console.log(`Navigation keyboard/render proof passed: ${layout}/${preset}`);
  }
  await stop();
  await fs.writeFile(
    path.join(artifacts, "navigation-report.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "Navigation proof passed for all three renderers with nested source data and actual keyboard/focus checks; this is not a full screen-reader/RTL/contrast audit.",
  );
} finally {
  await stop();
  await browser.close();
  await fs.writeFile(configFile, originalConfig);
  await fs.writeFile(manifestFile, originalManifest);
  // Only this test-created synthetic database is removed. Existing consumer data is untouched.
  await fs.rm(work, { recursive: true, force: true });
}
