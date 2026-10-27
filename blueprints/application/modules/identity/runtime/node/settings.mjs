import path from "node:path";
import { assertIdentityProfile } from "./profile.mjs";
export function settingsFor({ projectRoot, config, env = process.env }) {
  assertIdentityProfile(config);
  const appId = config.id;
  const publicOrigin = env.FORMA_PUBLIC_ORIGIN;
  let origin;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error("Explicit FORMA_PUBLIC_ORIGIN is required");
  }
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.origin !== publicOrigin ||
    !origin.port
  )
    throw new Error("Explicit loopback HTTP origin/port required");
  const organizationId = env.FORMA_ORGANIZATION_ID,
    databaseUrl = env.FORMA_IDENTITY_DATABASE_URL,
    secret = env.FORMA_AUTH_SECRET;
  if (
    typeof organizationId !== "string" ||
    !organizationId.trim() ||
    typeof secret !== "string" ||
    secret.length < 32 ||
    /^(?:change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|placeholder)/i.test(
      secret,
    ) ||
    typeof databaseUrl !== "string" ||
    !databaseUrl
  )
    throw new Error(
      "Explicit child identity database, organization and secret required",
    );
  let database;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error("Explicit PostgreSQL URL required");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["127.0.0.1", "localhost"].includes(database.hostname) ||
    !database.username ||
    !database.password ||
    !database.port ||
    Number(database.port) < 1 ||
    Number(database.port) > 65535 ||
    database.pathname.length < 2 ||
    database.search ||
    database.hash
  )
    throw new Error("Explicit isolated loopback PostgreSQL target required");
  if (typeof env.DATABASE_PATH !== "string" || !env.DATABASE_PATH)
    throw new Error(
      "Explicit DATABASE_PATH for authenticated domain store required",
    );
  const backendPort = Number(env.API_PORT || 8765);
  if (
    !Number.isInteger(backendPort) ||
    backendPort < 1 ||
    backendPort > 65535 ||
    backendPort === Number(origin.port)
  )
    throw new Error("Distinct explicit loopback API_PORT required");
  return {
    appId,
    organizationId,
    databaseUrl,
    secret,
    publicOrigin,
    origin,
    backendPort,
    databasePath: path.resolve(projectRoot, env.DATABASE_PATH),
    projectRoot: path.resolve(projectRoot),
    backendUrl: `http://127.0.0.1:${backendPort}`,
  };
}
