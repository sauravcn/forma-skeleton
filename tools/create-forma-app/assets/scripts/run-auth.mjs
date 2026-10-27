import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2] || "start";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
async function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  function stop(signal) {
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const terminate = () => stop("SIGTERM"),
    interrupt = () => stop("SIGINT");
  process.on("SIGTERM", terminate);
  process.on("SIGINT", interrupt);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`Required command exited (${code ?? signal})`)),
      );
    });
  } finally {
    process.off("SIGTERM", terminate);
    process.off("SIGINT", interrupt);
  }
}
try {
  if (action === "build") {
    await run(npm, ["run", "build", "--workspace", "frontend"]);
    await run(process.env.PYTHON_BIN || "python3", [
      "-m",
      "compileall",
      "-q",
      "backend-auth",
    ]);
  } else if (action === "test") {
    await run(npm, ["run", "test", "--workspace", "frontend"]);
    for (const directory of ["backend/tests", "backend-auth/tests"])
      await run(process.env.PYTHON_BIN || "python3", [
        "-m",
        "unittest",
        "discover",
        "-s",
        directory,
        "-v",
      ]);
    await run(npm, ["run", "test", "--workspace", "identity"]);
  } else if (["start", "dev"].includes(action)) {
    await run(process.execPath, [
      "identity/node/start.mjs",
      ...(action === "dev" ? ["--dev"] : []),
    ]);
  } else throw new Error("Use start, dev, build or test");
} catch {
  console.error(
    "Authenticated application command failed. Review configuration and documented prerequisites.",
  );
  process.exitCode = 1;
}
