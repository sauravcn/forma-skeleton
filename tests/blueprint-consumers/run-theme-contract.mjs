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
const work = await fs.mkdtemp(path.join(os.tmpdir(), "forma-theme-contract-"));
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
for (const name of ["theme.js", "theme-tokens.json", "styles.css"])
  await fs.copyFile(
    path.join(root, "blueprints/application/frontend/src", name),
    path.join(frontend, "src", name),
  );
const { defaultConfig, validateConfig } = await import(
  "../../packages/config/src/index.mjs"
);
const blueprint = JSON.parse(
  await fs.readFile(
    path.join(root, "blueprints/application/blueprint.json"),
    "utf8",
  ),
);
const themes = [
  {
    preset: "linen",
    tokens: {
      fontFamily: "Georgia, serif",
      headingFontFamily: "Arial, sans-serif",
      controlFontFamily: "Courier New, monospace",
      background: "#fff5e5",
      surface: "#ffffff",
      text: "#302040",
      accent: "#8a1665",
      onAccent: "#ffffff",
      sidebar: "#402050",
      sidebarText: "#ffffff",
      focus: "#006f75",
      navHover: "#ffcc00",
      navActive: "#ffcc00",
      navActiveOpacity: 0.25,
      success: "#166534",
      error: "#b91c1c",
      radius: 0,
      controlRadius: 0,
      navRadius: 0,
      bodyFontSize: 16,
      controlFontSize: 15,
      buttonFontSize: 14,
      headingScale: 1.2,
      spacingScale: 1.1,
      panelPadding: 30,
      controlPaddingY: 14,
      controlPaddingX: 18,
      motionDuration: 0,
      focusWidth: 4,
    },
  },
  {
    preset: "midnight",
    tokens: {
      fontFamily: "Courier New, monospace",
      headingFontFamily: "Georgia, serif",
      controlFontFamily: "Arial, sans-serif",
      background: "#071d30",
      surface: "#12304a",
      text: "#effaff",
      accent: "#a9e8d0",
      onAccent: "#082019",
      sidebar: "#00121f",
      sidebarText: "#d8f3ff",
      focus: "#f9c846",
      navHover: "#43d9ff",
      navActive: "#43d9ff",
      navActiveOpacity: 0.3,
      success: "#7be6ab",
      error: "#ffafaf",
      radius: 26,
      controlRadius: 18,
      navRadius: 16,
      bodyFontSize: 13,
      controlFontSize: 13,
      buttonFontSize: 13,
      headingScale: 0.85,
      spacingScale: 0.85,
      panelPadding: 18,
      controlPaddingY: 8,
      controlPaddingX: 10,
      motionDuration: 80,
      focusWidth: 2,
    },
  },
];
for (const theme of themes) {
  const value = defaultConfig();
  value.theme = theme;
  validateConfig(value, blueprint);
}
const configPath = path.join(work, "app.config.json");
const original = JSON.parse(await fs.readFile(configPath, "utf8"));
original.theme = themes[0];
await fs.writeFile(configPath, JSON.stringify(original, null, 2));
const route = path.join(frontend, "app/auth-view");
await fs.mkdir(route, { recursive: true });
await fs.writeFile(
  path.join(route, "page.jsx"),
  `"use client";
import Auth from '../../src/identity-ui/AuthPresentation.jsx';import '../../src/identity-ui/styles.css';
import Shell from '../../src/components/Shell.jsx';import RecordForm from '../../src/components/RecordForm.jsx';import config from '../../src/config.js';import {localization} from '../../src/i18n.js';
export default function Fixture(){return <Shell config={config} page="records" i={localization()} connection="connected" onRefresh={()=>{}} refreshing={false}><p>VIEW ONLY theme contract fixture; no login, delivery or saved record occurs.</p><div className="page-heading"><h1>Parent-controlled heading</h1></div><RecordForm i={localization()} busy={false} error={false} onCreate={async()=>true}/><Auth onSubmit={async()=>{}} variant="split" aside={<p>App-owned identity content</p>}/></Shell>}
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
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
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
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const screenshots = [];
  for (let index = 0; index < themes.length; index++) {
    const theme = themes[index];
    original.theme = theme;
    await fs.writeFile(configPath, JSON.stringify(original, null, 2));
    await page.goto(url);
    await page
      .getByText("VIEW ONLY theme contract fixture;", { exact: false })
      .waitFor();
    let applied = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        (await page
          .locator("body")
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--app-focus").trim(),
          )) === theme.tokens.focus
      ) {
        applied = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      await page.reload();
    }
    assert.ok(applied, "edited app config must reach the actual root theme");
    const body = await page.locator("body").evaluate((el) => ({
      font: getComputedStyle(el).fontFamily,
      background: getComputedStyle(el).backgroundColor,
    }));
    assert.match(body.font, index === 0 ? /Georgia/ : /Courier/);
    assert.match(
      await page
        .locator(".page-heading h1")
        .evaluate((el) => getComputedStyle(el).fontFamily),
      index === 0 ? /Arial/ : /Georgia/,
    );
    for (const selector of [
      "input[name=title]",
      "textarea[name=details]",
      ".forma-identity input[name=identifier]",
      ".forma-identity input[name=password]",
      ".forma-identity button[type=submit]",
    ]) {
      const control = page.locator(selector);
      assert.match(
        await control.evaluate((el) => getComputedStyle(el).fontFamily),
        index === 0 ? /Courier/ : /Arial/,
      );
      assert.equal(
        await control.evaluate((el) => getComputedStyle(el).borderRadius),
        theme.tokens.controlRadius + "px",
      );
    }
    await page.locator("input[name=title]").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator("textarea[name=details]")
        .evaluate((el) => getComputedStyle(el).outlineWidth),
      theme.tokens.focusWidth + "px",
    );
    assert.equal(
      await page
        .locator(".record-form-panel")
        .evaluate((el) => getComputedStyle(el).paddingTop),
      theme.tokens.panelPadding + "px",
    );
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 1100 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const screenshot = path.join(
        root,
        ".run/neutral-consumer",
        `theme-parent-${index + 1}-${size}.png`,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      const skip = page.locator(".skip-link");
      assert.equal(
        await skip.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return document.activeElement === el || box.bottom <= 0;
        }),
        true,
        "skip link is hidden unless focused",
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
    }
  }
  assert.deepEqual(errors, []);
  const evidence = {
    scope:
      "two real parent app.config themes; public view-only fixture, not auth acceptance",
    checks: [
      "generator and runtime validation",
      "distinct body heading control typography",
      "semantic shell/forms/identity colors and control radii",
      "focus width and spacing",
      "desktop/mobile overflow",
      "physically copied source and own npm ci",
    ],
    screenshots,
  };
  await fs.writeFile(
    path.join(root, ".run/neutral-consumer/theme-contract-report.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log("Semantic parent theme contract browser proof passed.");
} finally {
  try {
    if (browser) await browser.close();
  } finally {
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
