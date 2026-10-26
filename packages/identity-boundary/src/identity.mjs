/** Non-shipped basic-session boundary proof. Password/MFA lifecycle is not enabled. */
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";

const scopes = {
  viewer: ["records:read"],
  member: ["records:read", "records:write"],
  admin: [
    "records:read",
    "records:write",
    "records:read:any",
    "records:write:any",
  ],
};

export function createIdentity({
  databaseUrl,
  secret,
  appId,
  organizationId,
  publicOrigin,
}) {
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    typeof appId !== "string" ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(appId) ||
    typeof organizationId !== "string" ||
    !organizationId.trim()
  )
    throw new Error("Invalid identity fixture configuration");
  if (typeof databaseUrl !== "string" || !databaseUrl)
    throw new Error("Explicit PostgreSQL fixture URL is required");
  const database = new URL(databaseUrl);
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
    throw new Error(
      "Explicit loopback PostgreSQL fixture credentials, port and database are required",
    );
  const origin = new URL(publicOrigin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.origin !== publicOrigin
  )
    throw new Error(
      "Identity proof supports explicit loopback HTTP origin only",
    );
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 2000,
  });
  pool.on("error", () => {}); // No credential-bearing connection strings in fixture logs.
  const options = {
    appName: appId,
    baseURL: publicOrigin,
    secret,
    database: pool,
    trustedOrigins: [publicOrigin],
    emailAndPassword: { enabled: false },
    socialProviders: {},
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { cookieCache: { enabled: false }, expiresIn: 3600 },
    advanced: { cookiePrefix: `${appId}-proof` },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
  };
  let auth;
  async function initialize() {
    const { runMigrations } = await getMigrations(options);
    await runMigrations();
    await pool.query(`CREATE TABLE IF NOT EXISTS identity_memberships (
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('viewer','member','admin')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY(user_id,organization_id)
    )`);
    auth ??= betterAuth(options);
  }
  async function introspect(cookie) {
    if (
      typeof cookie !== "string" ||
      !cookie ||
      cookie.length > 8192 ||
      /[\r\n]/.test(cookie)
    )
      return { status: 401 };
    if (!auth) throw new Error("Identity fixture is not initialized");
    const context = await auth.$context;
    const name = context.authCookies.sessionToken.name;
    const pairs = cookie
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.split("=", 1)[0] === name);
    if (pairs.length !== 1 || !pairs[0].slice(name.length + 1))
      return { status: 401 };
    const result = await auth.api.getSession({
      headers: new Headers({ Cookie: pairs[0] }),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!result?.user?.id || !result.session?.expiresAt) return { status: 401 };
    const expires = new Date(result.session.expiresAt);
    if (!Number.isFinite(expires.getTime()) || expires <= new Date())
      return { status: 401 };
    const { rows } = await pool.query(
      "SELECT role FROM identity_memberships WHERE user_id=$1 AND organization_id=$2 AND active=TRUE",
      [result.user.id, organizationId],
    );
    if (!rows.length || !scopes[rows[0].role]) return { status: 403 };
    return {
      status: 200,
      principal: {
        app_id: appId,
        organization_id: organizationId,
        user_id: result.user.id,
        permissions: [...scopes[rows[0].role]],
        expires_at: expires.toISOString(),
        assurance: "basic-session-fixture",
      },
    };
  }
  return {
    get auth() {
      if (!auth)
        throw new Error("Initialize the explicit fixture before auth access");
      return auth;
    },
    pool,
    initialize,
    introspect,
    appId,
    organizationId,
  };
}
