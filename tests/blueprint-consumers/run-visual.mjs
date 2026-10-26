/** Render actual generated child themes/layouts and a trusted source replacement. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const artifactRoot = path.join(repository, ".run", "neutral-consumer");
const report = JSON.parse(
  await fs.readFile(path.join(artifactRoot, "report.json"), "utf8"),
);
const application = report.application,
  configFile = path.join(application, "app.config.json");
const original = JSON.parse(await fs.readFile(configFile, "utf8"));
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  npm_config_cache:
    process.env.npm_config_cache || path.join(repository, ".run", "npm-cache"),
};
let active = null;
function command(args, background = false, extra = {}) {
  const child = spawn("npm", args, {
    cwd: application,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`npm ${args.join(" ")} failed: ${output.slice(-8000)}`),
          ),
    );
  });
  if (background) {
    completion.catch(() => {});
    return {
      child,
      get output() {
        return output;
      },
    };
  }
  return completion;
}
async function stop() {
  if (!active) return;
  const child = active.child;
  active = null;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  await Promise.race([
    new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r))),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (child.exitCode === null && !child.signalCode)
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
}
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function start() {
  const web = await port();
  let api = await port();
  while (api === web) api = await port();
  active = command(["start"], true, {
    WEB_PORT: String(web),
    API_PORT: String(api),
    DATABASE_PATH: report.database,
  });
  const url = `http://127.0.0.1:${web}`;
  for (let n = 0; n < 240; n++) {
    if (active.child.exitCode !== null) throw new Error(active.output);
    try {
      if ((await fetch(url + "/api/records")).ok) return url;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Visual starter readiness failed: " + active.output);
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const preset of ["linen", "midnight"])
    for (const layout of ["sidebar", "top", "combined"]) {
      await stop();
      const config = structuredClone(original);
      config.theme.preset = preset;
      config.navigation.layout = layout;
      await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n");
      await command(["run", "build"]);
      const url = await start();
      const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url + "/records");
      await page
        .locator(".connection")
        .getByText("API connected", { exact: true })
        .waitFor();
      await page.locator(".development-notice").waitFor();
      if (!results.length) {
        await page
          .getByLabel("Record title", { exact: true })
          .fill("Browser proof record");
        await page
          .getByLabel(/^Details/)
          .fill("Synthetic data from the installed generator");
        await page
          .getByRole("button", { name: "Save record", exact: true })
          .click();
        const card = page
          .locator(".record-card")
          .filter({ hasText: "Browser proof record" });
        await card
          .getByRole("button", { name: "Mark complete", exact: true })
          .click();
        await card
          .getByRole("button", { name: "Reopen", exact: true })
          .waitFor();
        await page.reload();
        await page
          .locator(".record-card")
          .filter({ hasText: "Browser proof record" })
          .getByRole("button", { name: "Reopen", exact: true })
          .waitFor();
      } else
        await page
          .locator(".record-card")
          .filter({ hasText: "Browser proof record" })
          .waitFor();
      await page.screenshot({
        path: path.join(artifactRoot, `${preset}-${layout}-desktop.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("link", { name: "Records", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${preset}/${layout} no mobile page overflow`,
      );
      await page.screenshot({
        path: path.join(artifactRoot, `${preset}-${layout}-mobile.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await page.close();
      results.push({
        preset,
        layout,
        checks: [
          "actual render",
          "record persistence",
          "mobile navigation",
          "no page overflow",
          "no browser page errors",
        ],
      });
      console.log(`Visual passed: ${preset}/${layout}`);
    }
  await stop();
  // Prove a customer's trusted source can replace the shell's entire structure.
  const component = path.join(
    application,
    "frontend/src/components/ConsumerShell.jsx",
  );
  await fs.writeFile(
    component,
    'export default function ConsumerShell({children,i}) { return <main className="consumer-owned-layout"><h1>{i.t("guide.title")}</h1><aside className="development-notice">{i.t("app.publicNotice")}</aside>{children}</main>; }\n',
  );
  const registry = path.join(
      application,
      "frontend/src/components/registry.jsx",
    ),
    previous = await fs.readFile(registry, "utf8");
  await fs.writeFile(
    registry,
    previous.replace(
      'import Shell from "./Shell.jsx";',
      'import Shell from "./ConsumerShell.jsx";',
    ),
  );
  await command(["run", "build"]);
  const url = await start(),
    page = await browser.newPage();
  await page.goto(url + "/records");
  await page
    .getByRole("heading", {
      name: "The source is part of the product.",
      exact: true,
    })
    .waitFor();
  await page
    .locator(".record-card")
    .filter({ hasText: "Browser proof record" })
    .waitFor();
  assert.equal(
    await page.locator(".app-sidebar").count(),
    0,
    "custom registry replaces original shell structure",
  );
  await page.screenshot({
    path: path.join(artifactRoot, "consumer-source-replacement.png"),
    fullPage: true,
  });
  await page.close();
  results.push({ customSourceReplacement: true });
  await stop();
  // Retain original example source/config; the captured replacement was test-only.
  await fs.writeFile(registry, previous);
  await fs.unlink(component);
  await fs.writeFile(configFile, JSON.stringify(original, null, 2) + "\n");
  await fs.writeFile(
    path.join(artifactRoot, "visual-report.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "Generated consumer browser proof passed for six combinations and a full shell source replacement.",
  );
} finally {
  await stop();
  await browser.close();
}
