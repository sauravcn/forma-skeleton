/** Non-shipped maintained password lifecycle candidate; no MFA assurance. */
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins/username";
import { toNodeHandler } from "better-auth/node";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

export function createPasswordIdentity({
  databaseUrl,
  secret,
  appId,
  publicOrigin,
  sendMail,
  onDeliveryFailure,
  verificationExpiresIn = 3600,
}) {
  if (typeof sendMail !== "function")
    throw new Error("Explicit mail transport is required");
  if (typeof databaseUrl !== "string" || !databaseUrl)
    throw new Error("Explicit PostgreSQL URL is required");
  if (typeof onDeliveryFailure !== "function")
    throw new Error("Explicit redacted delivery-failure reporter is required");
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
      "Explicit isolated loopback PostgreSQL credentials, port and database required",
    );
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    typeof appId !== "string" ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(appId)
  )
    throw new Error("Invalid identity configuration");
  if (
    !Number.isInteger(verificationExpiresIn) ||
    verificationExpiresIn < 1 ||
    verificationExpiresIn > 3600
  )
    throw new Error("Invalid verification lifetime");
  const origin = new URL(publicOrigin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.origin !== publicOrigin
  )
    throw new Error("Explicit loopback origin required");
  const lockPool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 2000,
  });
  lockPool.on("error", () => {});
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 2000,
  });
  pool.on("error", () => {});
  const mailState = new AsyncLocalStorage();
  const deliver =
    (kind) =>
    async ({ user, url, token }) => {
      try {
        await sendMail({ kind, to: user.email, url, token });
      } catch {
        const state = mailState.getStore();
        if (state) state.failed = true;
        try {
          await onDeliveryFailure({ kind, code: "MAIL_TRANSPORT_FAILED" });
        } catch {
          /* Operational reporter failure must not expose account eligibility. */
        }
        if (!state) throw new Error("Mail transport unavailable");
      }
    };
  const options = {
    appName: appId,
    baseURL: publicOrigin,
    secret,
    database: pool,
    trustedOrigins: [publicOrigin],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: deliver("reset"),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: verificationExpiresIn,
      autoSignInAfterVerification: false,
      sendVerificationEmail: deliver("verification"),
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        usernameNormalization: (value) => value.toLowerCase(),
        usernameValidator: (value) => /^[a-zA-Z0-9_]{3,30}$/.test(value),
      }),
    ],
    socialProviders: {},
    account: { accountLinking: { enabled: false } },
    session: { cookieCache: { enabled: false }, expiresIn: 3600 },
    advanced: { cookiePrefix: `${appId}-candidate` },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
  };
  let auth;
  async function maintained(request) {
    const state = { failed: false };
    return mailState.run(state, async () => {
      const response = await auth.handler(request);
      const emailRequest = [
        "/api/auth/request-password-reset",
        "/api/auth/send-verification-email",
      ].includes(new URL(request.url).pathname);
      if (emailRequest && response.ok) {
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return Response.json(
          { status: true, message: "Check your inbox if eligible" },
          { headers },
        );
      }
      return response;
    });
  }
  const guardedHandler = toNodeHandler(async (request) => {
    const route = new URL(request.url).pathname;
    if (request.method !== "POST" || route !== "/api/auth/sign-up/email")
      return maintained(request);
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) {
          reader.releaseLock();
          return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
        }
        chunks.push(Buffer.from(value));
      }
    const text = Buffer.concat(chunks).toString("utf8");
    if (Buffer.byteLength(text) > 16384)
      return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ code: "INVALID_JSON" }, { status: 400 });
    }
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
    const forward = () =>
      maintained(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: text,
        }),
      );
    if (!email || email.length > 320) return forward();
    let client;
    try {
      client = await lockPool.connect();
    } catch {
      return Response.json({ code: "IDENTITY_UNAVAILABLE" }, { status: 503 });
    }
    try {
      await client.query("SET lock_timeout = '2s'");
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [email]);
      const response = await forward();
      if (response.ok) {
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return Response.json(
          { status: true, message: "Check your inbox if eligible" },
          { headers },
        );
      }
      return response;
    } catch {
      return Response.json({ code: "IDENTITY_UNAVAILABLE" }, { status: 503 });
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock_all()");
        client.release();
      } catch {
        client.release(true);
      }
    }
  });
  return {
    pool,
    async initialize() {
      const { runMigrations } = await getMigrations(options);
      await runMigrations();
      auth ??= betterAuth(options);
    },
    get auth() {
      if (!auth) throw new Error("Initialize before serving");
      return auth;
    },
    handler(req, res) {
      if (!auth) throw new Error("Initialize before serving");
      if (
        req.headers.host !== origin.host ||
        (!["GET", "HEAD"].includes(req.method) &&
          req.headers.origin !== publicOrigin)
      ) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "ORIGIN_NOT_ALLOWED" }));
        return;
      }
      return guardedHandler(req, res);
    },
    async close() {
      await Promise.all([pool.end(), lockPool.end()]);
    },
  };
}
