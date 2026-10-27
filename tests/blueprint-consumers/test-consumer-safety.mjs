import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  observeClose,
  stopOwnedChildren,
  safeFailureKind,
} from "./fixtures/consumer-safety.mjs";
test("cleanup awaits final stdout after TERM before a secret audit can pass", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on('SIGTERM',()=>setTimeout(()=>{process.stdout.write('late-secret-marker');process.exit(0)},80));process.stdout.write('ready');setInterval(()=>{},1000)`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = observeClose(child);
  let output = "";
  child.stdout.on("data", (x) => (output += x));
  try {
    await once(child.stdout, "data");
    await stopOwnedChildren([child]);
    await closed;
    assert.ok(output.includes("late-secret-marker"));
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
});
test("TERM-resistant owned child is killed and its streams close", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  observeClose(child);
  try {
    await once(child.stdout, "data");
    await stopOwnedChildren([child], { grace: 150 });
    assert.equal(child.signalCode, "SIGKILL");
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
});
test("failure categorization excludes token-bearing Playwright messages and unknown names", () => {
  const error = new Error(
    "page.goto https://example.test/?token=synthetic-secret",
  );
  error.name = "TimeoutError";
  assert.equal(safeFailureKind(error), "TimeoutError");
  error.name = "synthetic-secret";
  assert.equal(safeFailureKind(error), "Error");
});

test("failed process spawn closes without leaving an owned process", async () => {
  const child = spawn("/forma-consumer-missing-executable", [], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let failed = false;
  child.once("error", () => {
    failed = true;
  });
  observeClose(child);
  await stopOwnedChildren([child], { grace: 500 });
  assert.equal(failed, true);
});
