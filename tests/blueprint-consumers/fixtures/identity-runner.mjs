/** Copied outside the seller checkout by the installed authenticated-consumer test.
 * Mail is returned over private process IPC, never an HTTP test endpoint or log.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const projectRoot = process.argv[2];
const send = (message) =>
  new Promise((resolve, reject) => {
    if (!process.send)
      return reject(new Error("Private fixture IPC is required"));
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
let application;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    await application?.close();
    process.exit(0);
  } catch {
    await send({ type: "failure", name: "CleanupError" }).catch(() => {});
    process.exit(1);
  }
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
process.on("disconnect", () => void close());
try {
  const config = JSON.parse(
    await fs.readFile(path.join(projectRoot, "app.config.json"), "utf8"),
  );
  const { migrateApplication, createApplication } = await import(
    pathToFileURL(path.join(projectRoot, "identity/node/application.mjs"))
  );
  const options = {
    projectRoot,
    config,
    env: process.env,
    dev: false,
    sendMail: async (message) => send({ type: "mail", message }),
    onDeliveryFailure: async ({ kind, code }) =>
      send({ type: "delivery-failure", kind, code }),
  };
  if (process.env.FORMA_FIXTURE_MIGRATE === "1") {
    await migrateApplication(options);
    await send({ type: "migrated" });
    process.exit(0);
  }
  application = await createApplication(options);
  await application.start();
  await send({ type: "ready" });
} catch (error) {
  // Do not serialize arbitrary runtime errors: they can contain credential URLs.
  await send({ type: "failure", name: error?.name || "Error" }).catch(() => {});
  await application?.close().catch(() => {});
  process.exit(1);
}
