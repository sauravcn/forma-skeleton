import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  action = process.argv[2] || "start",
  python = process.env.PYTHON_BIN || "python3",
  npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let stopping = false;
function launch(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
  return child;
}
function signal(child, value) {
  if (!Number.isInteger(child.pid)) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, value);
    else child.kill(value);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) signal(child, "SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) signal(child, "SIGKILL");
  }, 3000);
  timer.unref();
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once("exit", resolve);
        }),
    ),
  );
  clearTimeout(timer);
}
for (const name of ["SIGINT", "SIGTERM"])
  process.on(name, async () => {
    await shutdown();
    process.exit(name === "SIGINT" ? 130 : 143);
  });
async function one(command, args) {
  const child = launch(command, args);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, sig) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${code ?? sig})`)),
    );
  });
}
function port(name, fallback) {
  const value = process.env[name] || fallback;
  if (
    !/^[0-9]+$/.test(String(value)) ||
    Number(value) < 1 ||
    Number(value) > 65535
  )
    throw new Error(`${name} must be a TCP port between 1 and 65535`);
  return Number(value);
}
async function available(port) {
  const { createServer } = await import("node:net");
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          `Port ${port} is already in use; select WEB_PORT/API_PORT explicitly`,
        ),
      ),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode)
      throw new Error(`Service exited before readiness: ${url}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Service readiness timed out: ${url}`);
}
try {
  if (action === "test") {
    await one(python, [
      "-m",
      "unittest",
      "discover",
      "-s",
      "backend/tests",
      "-v",
    ]);
    await one(npm, ["run", "test", "--workspace", "frontend"]);
  } else if (action === "build") {
    await one(npm, ["run", "build", "--workspace", "frontend"]);
    await one(python, ["-m", "compileall", "-q", "backend"]);
  } else if (["start", "dev"].includes(action)) {
    if (fs.existsSync(path.join(root, ".forma-generation.pending")))
      throw new Error(
        "Generation is incomplete; reconcile the pending marker before starting",
      );
    const web = port("WEB_PORT", 3000),
      api = port("API_PORT", 8765);
    if (web === api) throw new Error("WEB_PORT and API_PORT must differ");
    await available(web);
    await available(api);
    const backendURL = `http://127.0.0.1:${api}`,
      env = {
        ...process.env,
        API_PORT: String(api),
        FORMA_BACKEND_URL: backendURL,
        ALLOWED_ORIGINS:
          process.env.ALLOWED_ORIGINS ||
          `http://127.0.0.1:${web},http://localhost:${web}`,
      };
    const backend = launch(python, ["backend/server.py"], env);
    backend.once("error", (error) => {
      console.error(error.message);
      shutdown().then(() => process.exit(1));
    });
    await ready(`${backendURL}/api/health`, backend);
    const frontend = launch(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        action === "dev" ? "dev" : "start",
        "frontend",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(web),
      ],
      env,
    );
    frontend.once("error", (error) => {
      console.error(error.message);
      shutdown().then(() => process.exit(1));
    });
    for (const child of [backend, frontend])
      child.once("exit", (code, sig) => {
        if (!stopping) {
          console.error(
            `A required service exited (${code ?? sig}); stopping the application.`,
          );
          shutdown().then(() => process.exit(code || 1));
        }
      });
    await ready(`http://127.0.0.1:${web}/api/health`, frontend);
    console.log(
      `Public synthetic starter ready at http://127.0.0.1:${web}; authentication:none. Press Ctrl+C to stop both services.`,
    );
  } else throw new Error("Use start, dev, build or test");
} catch (error) {
  console.error(error.message);
  await shutdown();
  process.exitCode = 1;
}
