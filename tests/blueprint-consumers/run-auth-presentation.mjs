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
const work = await fs.mkdtemp(path.join(os.tmpdir(), "forma-auth-view-"));
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
      npm_config_cache: process.env.npm_config_cache || path.join(root, ".run", "npm-cache"),
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
const route = path.join(frontend, "app/auth-view");
await fs.mkdir(route, { recursive: true });
await fs.writeFile(
  path.join(route, "page.jsx"),
  `"use client";
import {useState} from 'react';
import Auth from '../../src/identity-ui/AuthPresentation.jsx';
import '../../src/identity-ui/styles.css';
function Replacement({children,title}){return <article data-testid="replacement" aria-label={title}><header>Customer-owned replacement layout</header>{children}</article>}
export default function Fixture(){const[view,setView]=useState('login'),[variant,setVariant]=useState('minimal'),[replacement,setReplacement]=useState(false),[provider,setProvider]=useState(false),[result,setResult]=useState(''),[failure,setFailure]=useState(false);return <div style={{'--app-fontFamily':'Georgia, serif','--app-text':'rgb(31, 45, 61)','--app-accent':'rgb(64, 50, 120)','--app-onAccent':'rgb(255, 255, 255)'}}>
<p>VIEW ONLY: controlled callbacks. No login, MFA, provider connection or delivery occurs.</p>
<label>Fixture view<select value={view} onChange={e=>setView(e.target.value)}>{['login','verify','resetRequest','reset','challenge','recovery'].map(v=><option key={v}>{v}</option>)}</select></label>
<button onClick={()=>setVariant(v=>v==='minimal'?'split':'minimal')}>Switch layout</button><button onClick={()=>setReplacement(v=>!v)}>Replace complete layout</button><button onClick={()=>setProvider(v=>!v)}>Configure fixture provider</button><button onClick={()=>setFailure(v=>!v)}>Toggle fixture failure</button>
<Auth view={view} variant={variant} onNavigate={setView} aside={<p>App-owned supporting content</p>} components={replacement?{AuthLayout:Replacement}:{}} providers={provider?[{id:'fixture',label:'Fixture provider',onSelect:async()=>setResult('provider callback only')}]:[]} onSubmit={async({view,values})=>{if(failure)throw Error('secret diagnostic never shown');setResult(view+' callback fields: '+Object.keys(values).join(','));}}/>
<output aria-label="Fixture callback result">{result}</output></div>}
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
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("VIEW ONLY:", { exact: false }).waitFor();
  const screenshotPaths = [];
  for (const layout of ["minimal", "split"]) {
    if (layout === "split")
      await page.getByRole("button", { name: "Switch layout" }).click();
    await page.locator(".forma-identity--" + layout).waitFor();
    for (const [size, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      const input = page.getByLabel("Email or username", { exact: true });
      assert.match(
        await input.evaluate((el) => getComputedStyle(el).fontFamily),
        /Georgia/,
      );
      assert.equal(
        await input.evaluate((el) => getComputedStyle(el).color),
        "rgb(31, 45, 61)",
      );
      assert.equal(
        await page
          .locator(".forma-identity button[type=submit]")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgb(64, 50, 120)",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const screenshot = path.join(
        root,
        ".run/neutral-consumer",
        `auth-${layout}-${size}.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshotPaths.push(screenshot);
    }
  }
  await page.getByRole("button", { name: "Switch layout" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(
    await page
      .getByRole("button", { name: "Continue with Fixture provider" })
      .count(),
    0,
  );
  await page
    .getByLabel("Email or username", { exact: true })
    .fill("synthetic-user");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Fixture callback result")
    .filter({ hasText: "login callback fields: identifier,password" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Password", { exact: true }).inputValue(),
    "",
  );
  await page.getByRole("button", { name: "Switch layout" }).click();
  await page.locator(".forma-identity--split aside").waitFor();
  await page.getByRole("button", { name: "Replace complete layout" }).click();
  await page.getByTestId("replacement").waitFor();
  assert.equal(await page.locator(".forma-identity").count(), 0);
  await page
    .getByRole("button", { name: "Configure fixture provider" })
    .click();
  await page
    .getByRole("button", { name: "Continue with Fixture provider" })
    .click();
  await page
    .getByLabel("Fixture callback result")
    .filter({ hasText: "provider callback only" })
    .waitFor();
  for (const [view, label, value] of [
    ["resetRequest", "Email", "synthetic@example.invalid"],
    ["reset", "New password", "synthetic-new-password"],
    ["challenge", "Authentication code", "123456"],
    ["recovery", "Recovery code", "synthetic-recovery"],
  ]) {
    await page.getByLabel("Fixture view").selectOption(view);
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByLabel("Fixture callback result")
      .filter({ hasText: view + " callback fields:" })
      .waitFor();
    assert.equal(
      await page.getByLabel(label, { exact: true }).inputValue(),
      "",
    );
  }
  await page.getByLabel("Fixture view").selectOption("verify");
  await page
    .getByRole("button", { name: "Request verification", exact: true })
    .click();
  await page
    .getByLabel("Fixture callback result")
    .filter({ hasText: "verify callback fields:" })
    .waitFor();
  await page
    .getByText("A request does not confirm delivery.", { exact: false })
    .waitFor();
  await page.getByLabel("Fixture view").selectOption("login");
  await page.getByRole("button", { name: "Toggle fixture failure" }).click();
  await page.getByLabel("Email or username", { exact: true }).fill("synthetic");
  await page.getByLabel("Password", { exact: true }).fill("synthetic");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "The request could not be completed." })
    .waitFor();
  assert.equal(
    await page
      .getByText("secret diagnostic never shown", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("role")),
    "alert",
  );
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  const evidence = {
    screenshots: screenshotPaths,
    scope: "view-only controlled callbacks, not authentication acceptance",
    checks: [
      "fresh independent npm ci",
      "parent input font/text and button color overrides",
      "minimal and split desktop/mobile screenshots",
      "minimal and split layout",
      "complete layout replacement",
      "configured callback provider only",
      "login/reset/verification/challenge/recovery callback views",
      "secret fields cleared",
      "generic focused errors",
      "mobile overflow",
      "no localStorage",
      "no browser page errors",
    ],
  };
  await fs.writeFile(
    path.join(root, ".run/neutral-consumer/auth-presentation-report.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    "Auth presentation controlled-callback browser proof passed; no real login/MFA/provider/delivery acceptance.",
  );
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
