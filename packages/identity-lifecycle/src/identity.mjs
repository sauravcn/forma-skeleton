/** Non-shipped maintained password lifecycle candidate; no MFA assurance. */
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins/username";
import { twoFactor } from "better-auth/plugins/two-factor";
import { toNodeHandler } from "better-auth/node";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { createAssurance } from "./assurance.mjs";

export function createPasswordIdentity({
  databaseUrl,
  secret,
  appId,
  publicOrigin,
  sendMail,
  onDeliveryFailure,
  verificationExpiresIn = 3600,
  enableTotp = false,
  requireMfa = false,
  organizationId,
}) {
  if (typeof sendMail !== "function")
    throw new Error("Explicit mail transport is required");
  if (typeof databaseUrl !== "string" || !databaseUrl)
    throw new Error("Explicit PostgreSQL URL is required");
  if (typeof onDeliveryFailure !== "function")
    throw new Error("Explicit redacted delivery-failure reporter is required");
  if (
    typeof requireMfa !== "boolean" ||
    (requireMfa &&
      (!enableTotp ||
        typeof organizationId !== "string" ||
        !organizationId.trim())) ||
    (organizationId !== undefined &&
      (typeof organizationId !== "string" ||
        !organizationId.trim() ||
        organizationId.length > 200))
  )
    throw new Error(
      "Explicit supported MFA policy and organization scope required",
    );
  if (typeof enableTotp !== "boolean")
    throw new Error("enableTotp must be explicit boolean");
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
  let auth;
  const assurance = createAssurance({
    pool,
    lockPool,
    requestState: mailState,
    getAuth: () => auth,
    appId,
    organizationId,
    enableTotp,
    requireMfa,
  });
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
      ...(enableTotp
        ? [
            twoFactor({
              issuer: appId,
              skipVerificationOnEnable: false,
              allowPasswordless: false,
              backupCodeOptions: {
                storeBackupCodes: "encrypted",
                allowPasswordless: false,
              },
            }),
          ]
        : []),
      assurance.plugin,
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
    advanced: {
      cookiePrefix: `${appId}-candidate`,
      ipAddress: { ipAddressHeaders: ["x-forma-socket-ip"] },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
  };
  async function maintained(request) {
    const state = { failed: false };
    return mailState.run(state, async () => {
      try {
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
      } finally {
        await assurance.release();
      }
    });
  }
  const guardedHandler = toNodeHandler(async (request) => {
    const route = new URL(request.url).pathname;
    const factorRoute = route.startsWith("/api/auth/two-factor/");
    if (factorRoute && new URL(request.url).search)
      return Response.json(
        { code: "UNSUPPORTED_FACTOR_OPTION" },
        { status: 400 },
      );
    if (
      request.method !== "POST" ||
      (route !== "/api/auth/sign-up/email" &&
        !factorRoute &&
        !(
          enableTotp &&
          ["/api/auth/sign-in/email", "/api/auth/sign-in/username"].includes(
            route,
          )
        ))
    )
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
    if (
      enableTotp &&
      body &&
      typeof body === "object" &&
      [
        "trustDevice",
        "skipVerification",
        "skipVerificationOnEnable",
        "twoFactorEnabled",
        "disableSession",
      ].some((key) => Object.hasOwn(body, key))
    )
      return Response.json(
        { code: "UNSUPPORTED_FACTOR_OPTION" },
        { status: 400 },
      );
    if (!factorRoute && route !== "/api/auth/sign-up/email")
      return maintained(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: text,
        }),
      );
    if (factorRoute) {
      const allowed = {
        "/api/auth/two-factor/enable": ["password", "method"],
        "/api/auth/two-factor/disable": ["password"],
        "/api/auth/two-factor/get-totp-uri": ["password"],
        "/api/auth/two-factor/generate-backup-codes": ["password"],
        "/api/auth/two-factor/verify-totp": ["code"],
        "/api/auth/two-factor/verify-backup-code": ["code"],
      };
      if (!enableTotp || !allowed[route])
        return Response.json(
          { code: "UNSUPPORTED_FACTOR_OPERATION" },
          { status: 404 },
        );
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== "object" ||
        Object.keys(body).some((key) => !allowed[route].includes(key)) ||
        (body.method !== undefined && body.method !== "totp")
      )
        return Response.json(
          { code: "UNSUPPORTED_FACTOR_OPTION" },
          { status: 400 },
        );
      if (allowed[route].includes("password")) {
        const session = await auth.api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        if (!session?.user?.emailVerified)
          return Response.json(
            { code: "VERIFIED_SESSION_REQUIRED" },
            { status: 401 },
          );
        if (
          [
            "/api/auth/two-factor/disable",
            "/api/auth/two-factor/generate-backup-codes",
          ].includes(route) &&
          !(await assurance.hasProof(session))
        )
          return Response.json(
            { code: "CURRENT_MFA_REQUIRED" },
            { status: 403 },
          );
        if (
          route === "/api/auth/two-factor/get-totp-uri" &&
          session.user.twoFactorEnabled &&
          !(await assurance.hasProof(session))
        )
          return Response.json(
            { code: "CURRENT_MFA_REQUIRED" },
            { status: 403 },
          );
        if (typeof body.password !== "string" || !body.password)
          return Response.json(
            { code: "CURRENT_PASSWORD_REQUIRED" },
            { status: 400 },
          );
      }
      return maintained(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: text,
        }),
      );
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
      const existingPolicy = await pool.query(
        "SELECT to_regclass('forma_identity_policy') AS name",
      );
      if (existingPolicy.rows[0].name) {
        const persisted = (
          await pool.query(
            "SELECT app_id,organization_id,require_mfa FROM forma_identity_policy WHERE singleton=TRUE",
          )
        ).rows[0];
        if (
          persisted &&
          (persisted.app_id !== appId ||
            persisted.organization_id !== (organizationId || "") ||
            persisted.require_mfa !== requireMfa)
        )
          throw new Error("Persisted identity scope/security policy mismatch");
      }
      if (
        !enableTotp &&
        (
          await pool.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='user' AND column_name='twoFactorEnabled'",
          )
        ).rowCount &&
        (
          await pool.query(
            'SELECT 1 FROM "user" WHERE "twoFactorEnabled"=TRUE LIMIT 1',
          )
        ).rowCount
      )
        throw new Error("Refusing enrolled MFA security downgrade");
      const { runMigrations } = await getMigrations(options);
      await runMigrations();
      await assurance.initialize();
      auth ??= betterAuth(options);
    },
    introspect: assurance.introspect,
    setMfaPolicy: assurance.setMfaPolicy,
    appId,
    organizationId,
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
      if (
        enableTotp &&
        (req.headers.cookie || "")
          .split(";")
          .some(
            (part) =>
              part.trim().split("=")[0] === `${appId}-candidate.trust_device`,
          )
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "TRUST_DEVICE_UNSUPPORTED" }));
        return;
      }
      const peer = req.socket.remoteAddress;
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "SOCKET_PEER_UNSUPPORTED" }));
        return;
      }
      for (const name of Object.keys(req.headers))
        if (
          name === "forwarded" ||
          name.startsWith("x-forwarded-") ||
          [
            "x-real-ip",
            "cf-connecting-ip",
            "true-client-ip",
            "fastly-client-ip",
            "fly-client-ip",
            "x-forma-socket-ip",
          ].includes(name)
        )
          delete req.headers[name];
      req.headers["x-forma-socket-ip"] = peer;
      return guardedHandler(req, res);
    },
    async close() {
      await Promise.all([pool.end(), lockPool.end()]);
    },
  };
}
