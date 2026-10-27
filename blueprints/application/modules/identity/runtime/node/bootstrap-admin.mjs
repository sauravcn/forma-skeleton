import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { settingsFor } from "./settings.mjs";
import { withIdentityStore } from "./store.mjs";
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let identity;
try {
  try {
    process.loadEnvFile(path.join(projectRoot, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const config = JSON.parse(
      await readFile(path.join(projectRoot, "app.config.json"), "utf8"),
    ),
    settings = settingsFor({ projectRoot, config, env: process.env });
  const index = process.argv.indexOf("--user-id"),
    userId = index >= 0 ? process.argv[index + 1] : null;
  if (!userId) throw new Error("Explicit user ID required");
  const { createPasswordIdentity } = await import(
      pathToFileURL(
        path.join(projectRoot, "identity/core/lifecycle/src/identity.mjs"),
      )
    ),
    policy = await import(
      pathToFileURL(path.join(projectRoot, "backend-auth/policy.mjs"))
    );
  identity = createPasswordIdentity({
    ...settings,
    enableTotp: true,
    requireMfa: true,
    permissionPolicy: policy.permissionPolicy,
    sendMail: async () => {
      throw new Error("Operator command cannot send mail");
    },
    onDeliveryFailure: async () => {},
  });
  await withIdentityStore(settings, { migrate: false }, () =>
    identity.initialize({ migrate: false }),
  );
  await policy.verifyPolicy(identity.pool);
  await policy.bootstrapAdministrator({
    userId,
    organizationId: settings.organizationId,
    pool: identity.pool,
  });
  process.stdout.write(
    "Explicit administrator membership assigned; current MFA proof remains required.\n",
  );
} catch {
  process.stderr.write(
    "Administrator bootstrap failed; requires an explicit existing verified member and owned ready stores.\n",
  );
  process.exitCode = 1;
} finally {
  if (identity) await identity.close();
}
