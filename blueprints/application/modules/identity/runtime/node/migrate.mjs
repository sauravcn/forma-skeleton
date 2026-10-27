import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateApplication } from "./application.mjs";
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
try {
  try {
    process.loadEnvFile(path.join(projectRoot, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const config = JSON.parse(
    await readFile(path.join(projectRoot, "app.config.json"), "utf8"),
  );
  await migrateApplication({
    projectRoot,
    config,
    env: process.env,
    sendMail: async () => {
      throw new Error("Migration command cannot send mail");
    },
    onDeliveryFailure: async () => {},
  });
  process.stdout.write("Owned identity and domain stores migrated.\n");
} catch {
  process.stderr.write(
    "Explicit authenticated migration failed; verify store scope, source inventory and configuration.\n",
  );
  process.exitCode = 1;
}
