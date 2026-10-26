/** Optional UI source proof only: no identity server, actual credentials, or session grants. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { identityMessages, identityText } = await import(
  "../../blueprints/application/modules/identity-ui/src/messages.js"
);
const { validateCatalog, translate } = await import(
  "../../blueprints/application/frontend/src/i18n.js"
);
assert.equal(
  identityText(
    identityMessages({ provider: "{provider} account — continue" }).provider,
    { provider: "<synthetic>" },
  ),
  "<synthetic> account — continue",
);
assert.throws(() => identityMessages({ provider: "Missing placeholder" }));
assert.throws(() => identityMessages({ provider: "{provider} {unexpected}" }));
assert.throws(() => identityMessages({ unknown: "not a key" }));
assert.throws(() => identityText("{provider}"));
const english = JSON.parse(
  await fs.readFile(
    path.join(root, "blueprints/application/frontend/src/messages/en.json"),
    "utf8",
  ),
);
assert.equal(validateCatalog(english), true);
for (const key of Object.keys(english))
  assert.ok(!translate(key, { count: 2 }).includes("undefined"));
assert.throws(() => validateCatalog({ "unknown.key": "bad" }));
assert.throws(() =>
  validateCatalog({ "app.recordsCount": { other: "{wrong}" } }),
);
const report = JSON.parse(
  await fs.readFile(
    path.join(root, ".run/neutral-consumer/report.json"),
    "utf8",
  ),
);
const consumer = await fs.realpath(report.application);
assert.ok(consumer.startsWith((await fs.realpath(os.tmpdir())) + path.sep));
assert.equal(
  JSON.parse(
    await fs.readFile(path.join(consumer, ".forma-generation.json"), "utf8"),
  ).state,
  "complete",
);
const work = await fs.mkdtemp(
  path.join(os.tmpdir(), "forma-presentation-accessibility-"),
);
const frontend = path.join(work, "frontend");
await fs.cp(path.join(consumer, "frontend"), frontend, {
  recursive: true,
  filter: (p) => !["node_modules", ".next"].includes(path.basename(p)),
});
await fs.copyFile(
  path.join(consumer, "app.config.json"),
  path.join(work, "app.config.json"),
);
for (const file of ["package.json", "package-lock.json"])
  await fs.copyFile(path.join(consumer, file), path.join(work, file));
await new Promise((resolve, reject) => {
  const install = spawn("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: work,
    env: {
      ...process.env,
      npm_config_cache:
        process.env.npm_config_cache || path.join(root, ".run", "npm-cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  install.stdout.on("data", (c) => (output = (output + c).slice(-12000)));
  install.stderr.on("data", (c) => (output = (output + c).slice(-12000)));
  install.once("error", reject);
  install.once("exit", (code) =>
    code === 0 ? resolve() : reject(Error("fixture npm ci failed: " + output)),
  );
});
await fs.cp(
  path.join(root, "blueprints/application/modules/identity-ui/src"),
  path.join(frontend, "src/identity-ui"),
  { recursive: true },
);
await fs.copyFile(
  path.join(root, "blueprints/application/frontend/src/i18n.js"),
  path.join(frontend, "src/i18n.js"),
);
await fs.copyFile(
  path.join(root, "blueprints/application/frontend/src/styles.css"),
  path.join(frontend, "src/styles.css"),
);
await fs.cp(path.join(consumer, "backend"), path.join(work, "backend"), {
  recursive: true,
  filter: (p) =>
    !["data", "__pycache__"].includes(path.basename(p)) &&
    !p.endsWith(".sqlite3") &&
    !p.endsWith(".sqlite"),
});
await fs.copyFile(
  path.join(
    root,
    "blueprints/application/frontend/src/components/RecordForm.jsx",
  ),
  path.join(frontend, "src/components/RecordForm.jsx"),
);
const fixtureCatalog = JSON.parse(
  await fs.readFile(path.join(frontend, "src/messages/en.json"), "utf8"),
);
for (const key of [
  "nav.overview",
  "nav.records",
  "nav.configuration",
  "records.titleLabel",
  "records.save",
])
  fixtureCatalog[key] +=
    " with an intentionally lengthy English label for layout stress";
await fs.writeFile(
  path.join(frontend, "src/messages/en.json"),
  JSON.stringify(fixtureCatalog, null, 2),
);
const fixtureConfig = JSON.parse(
  await fs.readFile(path.join(work, "app.config.json"), "utf8"),
);
fixtureConfig.navigation.layout = "combined";
await fs.writeFile(
  path.join(work, "app.config.json"),
  JSON.stringify(fixtureConfig, null, 2),
);
const fixtureLayout = path.join(frontend, "app/layout.jsx");
await fs.writeFile(
  fixtureLayout,
  (await fs.readFile(fixtureLayout, "utf8")).replace('dir="ltr"', 'dir="rtl"'),
);
const apiListener = net.createServer();
await new Promise((r) => apiListener.listen(0, "127.0.0.1", r));
const apiPort = apiListener.address().port;
await new Promise((r) => apiListener.close(r));
const database = path.join(work, "synthetic-records.sqlite");
const backend = spawn("python3", ["backend/server.py"], {
  cwd: work,
  env: { ...process.env, API_PORT: String(apiPort), DATABASE_PATH: database },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let backendLogs = "";
backend.stdout.on(
  "data",
  (c) => (backendLogs = (backendLogs + c).slice(-8000)),
);
backend.stderr.on(
  "data",
  (c) => (backendLogs = (backendLogs + c).slice(-8000)),
);
const route = path.join(frontend, "app/auth-view");
await fs.mkdir(route, { recursive: true });
await fs.writeFile(
  path.join(route, "page.jsx"),
  `"use client";
import {useState} from 'react';
import Auth from '../../src/identity-ui/AuthPresentation.jsx';
import '../../src/identity-ui/styles.css';
const long='An intentionally much longer English label for layout stress testing and accessible interaction';
export default function Fixture(){const[rtl,setRtl]=useState(false),[labels,setLabels]=useState(false),[view,setView]=useState('login');return <div dir={rtl?'rtl':'ltr'}>
<p>VIEW ONLY accessibility fixture, not live identity acceptance</p>
<button onClick={()=>setRtl(v=>!v)}>Toggle direction</button><button onClick={()=>setLabels(v=>!v)}>Toggle long labels</button>
<Auth view={view} onNavigate={setView} variant="split" messages={labels?{identifier:long,password:long+' password',submit:long,provider:'{provider} — '+long}:{}} providers={[{id:'stable-provider',label:'Synthetic Provider',onSelect:async()=>{}}]} onSubmit={async()=>{throw Error('Never display this diagnostic')}} aside={<p>Parent supporting content</p>}/>
</div>}
`,
);
const server = net.createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const child = spawn(
  process.execPath,
  [
    path.join(work, "node_modules/next/dist/bin/next"),
    "dev",
    frontend,
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: work,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      FORMA_BACKEND_URL: `http://127.0.0.1:${apiPort}`,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
child.stdout.on("data", (c) => (logs = (logs + c).slice(-12000)));
child.stderr.on("data", (c) => (logs = (logs + c).slice(-12000)));
let browser;
try {
  const url = `http://127.0.0.1:${port}/auth-view`;
  let ready = false;
  for (let n = 0; n < 180; n++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(10000) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const identifier = page.locator("input[name=identifier]"),
    password = page.locator("input[name=password]");
  const ids = await page
    .locator("form input")
    .evaluateAll((nodes) => nodes.map((n) => ({ id: n.id, name: n.name })));
  await page.getByRole("button", { name: "Toggle direction" }).click();
  await page.getByRole("button", { name: "Toggle long labels" }).click();
  assert.deepEqual(
    await page
      .locator("form input")
      .evaluateAll((nodes) => nodes.map((n) => ({ id: n.id, name: n.name }))),
    ids,
  );
  assert.equal(
    await identifier.evaluate((el) => getComputedStyle(el).direction),
    "rtl",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await page
      .locator(".forma-identity")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await identifier.focus();
  await page.keyboard.type("synthetic-identifier");
  await page.keyboard.press("Tab");
  assert.equal(
    await password.evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.type("synthetic-secret");
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator("form button")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "The request could not be completed." });
  await alert.waitFor();
  assert.equal(
    await alert.evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await identifier.inputValue(), "synthetic-identifier");
  assert.equal(await password.inputValue(), "");
  assert.equal(
    await identifier.getAttribute("aria-describedby"),
    await alert.getAttribute("id"),
  );
  assert.equal(
    await page
      .getByText("Never display this diagnostic", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: /Synthetic Provider —/ }).waitFor();
  const screenshot = path.join(
    root,
    ".run/neutral-consumer/presentation-rtl-long-mobile.png",
  );
  await page.screenshot({ path: screenshot, fullPage: true });
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .count();
  assert.deepEqual(errors, []);
  // Foundation proof talks only to the freshly copied API and its own synthetic DB.
  const apiHealth = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await apiHealth.json()).mode, "public-synthetic");
  await page.goto(`http://127.0.0.1:${port}/records`);
  await page.getByText("API connected", { exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  async function navigationContained(region) {
    const failures = await region.evaluate((node) => {
      const regionBox = node.getBoundingClientRect();
      const failures = [];
      for (const link of node.querySelectorAll("[data-navigation-id]")) {
        const a = link.getBoundingClientRect(),
          label = link.querySelector("span"),
          b = label.getBoundingClientRect();
        if (a.width === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        for (const [name, box] of [
          ["link", a],
          ["label", b],
          ["text", text],
        ])
          if (
            box.left < regionBox.left - 1 ||
            box.right > regionBox.right + 1 ||
            box.left < a.left - 1 ||
            box.right > a.right + 1
          )
            failures.push({
              id: link.dataset.navigationId,
              name,
              left: box.left,
              right: box.right,
              regionLeft: regionBox.left,
              regionRight: regionBox.right,
              linkLeft: a.left,
              linkRight: a.right,
            });
      }
      return failures;
    });
    assert.deepEqual(
      failures,
      [],
      "navigation content must stay inside its own link and navigation region",
    );
  }
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await menu.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Main navigation",
    exact: true,
  });
  await dialog.waitFor();
  await navigationContained(dialog);
  await dialog.locator('[data-navigation-id="overview"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**/");
  await page.locator("main").evaluate((el) => {
    if (el !== document.activeElement) throw Error("route focus missing");
  });
  await menu.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  await navigationContained(dialog);
  await dialog.locator('[data-navigation-id="records"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**/records");
  assert.equal(
    await page
      .locator('#mobile-navigation [data-navigation-id="records"]')
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
  );
  assert.equal(
    await page
      .locator("form button[type=submit]")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  assert.equal(
    await page
      .locator("form button[type=submit]")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  const recordTitle = "Synthetic RTL keyboard record";
  await page.locator("input[name=title]").fill(recordTitle);
  await page
    .locator("textarea[name=details]")
    .fill("Fictional fixture details only.");
  await page.locator("form button[type=submit]").focus();
  await page.keyboard.press("Enter");
  await page.getByText(recordTitle, { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const field = document.querySelector("input[name=title]");
    return (
      field && document.activeElement === field && !field.matches(":disabled")
    );
  });
  await page.reload();
  await page.getByText(recordTitle, { exact: true }).waitFor();
  const actualRecords = await fetch(`http://127.0.0.1:${apiPort}/api/records`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await actualRecords.json()).records[0].title, recordTitle);
  assert.ok((await fs.stat(database)).size > 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const foundationScreenshots = [];
  for (const [name, viewport] of [
    ["mobile", { width: 390, height: 844 }],
    ["desktop", { width: 1440, height: 1000 }],
  ]) {
    await page.setViewportSize(viewport);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (name === "desktop") {
      await navigationContained(page.locator(".app-sidebar"));
      assert.equal(
        await page
          .locator(".app-sidebar [aria-current=page]")
          .evaluate((el) => getComputedStyle(el).borderInlineStartWidth),
        "3px",
      );
      await navigationContained(page.locator(".top-navigation"));
    } else {
      await menu.click();
      await dialog.waitFor();
      await navigationContained(dialog);
      await page.keyboard.press("Escape");
    }
    const screenshot = path.join(
      root,
      ".run/neutral-consumer",
      `foundation-rtl-long-${name}.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: true });
    foundationScreenshots.push(screenshot);
  }
  assert.deepEqual(errors, []);
  const evidence = {
    scope:
      "English stress/RTL rendering only; no translated language, full WCAG or live identity acceptance",
    checks: [
      "catalog placeholder failures",
      "stable nontranslated field IDs under long labels",
      "RTL mobile overflow",
      "reduced-motion media",
      "native keyboard Tab and Enter submission",
      "focused linked generic error",
      "nonsecret identifier retained/secret cleared on failure",
      "whole provider message placeholder",
      "base RTL long navigation keyboard route focus/active marker",
      "base record create/reload persisted in own synthetic API/database",
      "base mobile/desktop overflow screenshots",
      "navigation link/label/text geometric containment in own regions",
    ],
    screenshot,
    foundationScreenshots,
  };
  await fs.writeFile(
    path.join(
      root,
      ".run/neutral-consumer/presentation-accessibility-report.json",
    ),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log("Presentation accessibility bounded proof passed.");
} finally {
  try {
    if (browser) await browser.close();
  } finally {
    if (backend.exitCode === null) {
      try {
        process.kill(-backend.pid, "SIGTERM");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
      await Promise.race([
        new Promise((r) => backend.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (backend.exitCode === null) {
        try {
          process.kill(-backend.pid, "SIGKILL");
        } catch (e) {
          if (e.code !== "ESRCH") throw e;
        }
      }
    }
    let apiClosed = false;
    for (let n = 0; n < 40; n++) {
      try {
        await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
          signal: AbortSignal.timeout(500),
        });
      } catch {
        apiClosed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(apiClosed, "owned API port must close");
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (e) {
          if (e.code !== "ESRCH") throw e;
        }
      }
    }
    let closed = false;
    for (let n = 0; n < 40; n++) {
      try {
        await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(500),
        });
      } catch {
        closed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(closed, "owned fixture port must close");
    await fs.rm(work, { recursive: true, force: true });
  }
}
