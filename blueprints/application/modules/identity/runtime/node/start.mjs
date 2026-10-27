import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "./application.mjs";
import { smtpMail } from "./mail.mjs";
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let app, mail;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (app) await app.close();
    if (mail) mail.close();
    process.exit(0);
  });
try {
  try {
    process.loadEnvFile(path.join(projectRoot, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const config = JSON.parse(
    await readFile(path.join(projectRoot, "app.config.json"), "utf8"),
  );
  mail = smtpMail(process.env, { appName: config.name });
  app = await createApplication({
    projectRoot,
    config,
    env: process.env,
    sendMail: mail.sendMail,
    onDeliveryFailure: mail.onDeliveryFailure,
    dev: process.argv.includes("--dev"),
  });
  await app.start();
  process.stdout.write(`Application ready at ${app.url}\n`);
} catch {
  if (app) await app.close();
  if (mail) mail.close();
  process.stderr.write(
    "Authenticated application startup failed; check explicit configuration, migrations and local ports.\n",
  );
  process.exitCode = 1;
}
