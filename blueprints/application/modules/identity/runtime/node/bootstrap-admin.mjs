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
  const args = process.argv.slice(2),
    flags = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (
      !["--user-id", "--email", "--role", "--approve-member"].includes(key) ||
      flags.has(key)
    )
      throw Error("Unknown or repeated operator argument");
    if (key === "--approve-member") flags.set(key, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw Error("Operator argument value required");
      flags.set(key, value);
    }
  }
  let userId = flags.get("--user-id");
  const email = flags.get("--email"),
    approve = flags.has("--approve-member"),
    role = flags.get("--role") || "member";
  if (
    Boolean(userId) === Boolean(email) ||
    (email && (email.length > 320 || email.trim() !== email)) ||
    (!approve && flags.has("--role"))
  )
    throw Error("Choose one explicit verified account selector and operation");
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
  if (email) {
    const result = await identity.pool.query(
      'SELECT id FROM "user" WHERE lower(email)=lower($1) AND "emailVerified"=TRUE',
      [email],
    );
    if (result.rowCount !== 1)
      throw Error("Exactly one verified child account required");
    userId = result.rows[0].id;
  }
  const operation = {
    userId,
    organizationId: settings.organizationId,
    pool: identity.pool,
  };
  if (approve) await policy.approveMembership({ ...operation, role });
  else await policy.bootstrapAdministrator(operation);
  process.stdout.write(
    approve
      ? "Explicit verified membership approved; current MFA proof remains required.\n"
      : "Explicit administrator membership assigned; current MFA proof remains required.\n",
  );
} catch {
  process.stderr.write(
    "Operator admission failed; choose a verified account, supported operation and owned ready stores.\n",
  );
  process.exitCode = 1;
} finally {
  if (identity) await identity.close();
}
