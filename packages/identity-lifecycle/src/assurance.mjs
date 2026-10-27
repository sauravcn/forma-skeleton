/** Server-owned proof tied to maintained session IDs; not client MFA metadata. */
import {
  createAuthMiddleware,
  createAuthEndpoint,
  APIError,
  isAPIError,
} from "better-auth/api";
import { expireCookie } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { timingSafeEqual } from "node:crypto";

const credentialPaths = new Set(["/sign-in/email", "/sign-in/username"]);
const mutationPaths = new Set([
  "/reset-password",
  "/change-password",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);
const sensitivePaths = new Set([
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
]);
const verifiedPaths = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);
export function createAssurance({
  pool,
  lockPool,
  requestState,
  getAuth,
  appId,
  organizationId,
  enableTotp,
  requireMfa,
  permissionPolicy,
}) {
  async function initialize({ migrate = true } = {}) {
    if (migrate)
      await pool.query(
        "INSERT INTO forma_identity_policy(singleton,app_id,organization_id,require_mfa) VALUES(TRUE,$1,$2,$3) ON CONFLICT DO NOTHING",
        [appId, organizationId || "", requireMfa],
      );
    const policy = (
      await pool.query(
        "SELECT * FROM forma_identity_policy WHERE singleton=TRUE",
      )
    ).rows[0];
    if (
      policy.app_id !== appId ||
      policy.organization_id !== (organizationId || "") ||
      policy.require_mfa !== requireMfa
    )
      throw new Error(
        "Persisted identity scope/security policy mismatch; explicit migration required",
      );
  }
  async function hasProof(session) {
    if (!enableTotp || !session?.session?.id || !session?.user?.emailVerified)
      return false;
    const result = await pool.query(
      `SELECT 1 FROM forma_session_assurance a JOIN session s ON s.id=a.session_id JOIN forma_user_security u ON u.user_id=a.user_id JOIN "user" confirmed_user ON confirmed_user.id=a.user_id AND confirmed_user."twoFactorEnabled"=TRUE JOIN "twoFactor" confirmed_factor ON confirmed_factor."userId"=a.user_id AND confirmed_factor.verified=TRUE CROSS JOIN forma_identity_policy p WHERE a.session_id=$1 AND a.user_id=$2 AND s."userId"=a.user_id AND s."expiresAt">NOW() AND a.user_epoch=u.epoch AND a.policy_epoch=p.epoch AND p.app_id=$3 AND p.organization_id=$4`,
      [session.session.id, session.user.id, appId, organizationId || ""],
    );
    return result.rowCount === 1;
  }
  async function acquire(state, userId) {
    const client = await lockPool.connect();
    state.factorLock = client;
    await client.query("SET lock_timeout='2s'");
    await client.query("SELECT pg_advisory_lock_shared(hashtext($1))", [
      `policy:${appId}`,
    ]);
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      `factor:${userId}`,
    ]);
    return client;
  }
  async function invalidate(userId, client) {
    await client.query("BEGIN");
    try {
      await client.query(
        "DELETE FROM forma_session_assurance WHERE user_id=$1",
        [userId],
      );
      await client.query(
        "INSERT INTO forma_user_security(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET epoch=forma_user_security.epoch+1",
        [userId],
      );
      await client.query(
        "DELETE FROM verification WHERE value=$1 AND identifier LIKE '2fa-%'",
        [userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  const plugin = {
    id: "forma-session-assurance",
    endpoints: {
      formaDescriptor: createAuthEndpoint(
        "/forma-state",
        { method: "GET", requireHeaders: true },
        async (ctx) => {
          const current = await getAuth().api.getSession({
            headers: ctx.headers,
            query: { disableCookieCache: true, disableRefresh: true },
          });
          if (current?.user) {
            if (!current.user.emailVerified)
              return ctx.json({ stage: "forbidden" });
            if (!current.user.twoFactorEnabled)
              return ctx.json({
                stage: "enroll",
                user: { name: current.user.name },
              });
            if (!(await hasProof(current)))
              return ctx.json({
                stage: "challenge",
                user: { name: current.user.name },
              });
            const result = await introspect(ctx.headers.get("cookie") || "");
            return ctx.json({
              stage: result.status === 200 ? "authenticated" : "forbidden",
              user: { name: current.user.name },
            });
          }
          const signed = await ctx.getSignedCookie(
            ctx.context.createAuthCookie("two_factor").name,
            ctx.context.secret,
          );
          if (signed) {
            const record =
              await ctx.context.internalAdapter.findVerificationValue(signed);
            if (record && new Date(record.expiresAt) > new Date())
              return ctx.json({ stage: "challenge" });
          }
          return ctx.json({ stage: "signed-out" });
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            verifiedPaths.has(ctx.path) ||
            mutationPaths.has(ctx.path) ||
            sensitivePaths.has(ctx.path) ||
            credentialPaths.has(ctx.path) ||
            ctx.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            const state = requestState.getStore();
            if (ctx.path === "/sign-out") {
              if (!state)
                throw new APIError("FORBIDDEN", {
                  code: "MANAGED_HTTP_REQUIRED",
                  message: "Managed HTTP context required",
                });
              const current = await getAuth().api.getSession({
                headers: ctx.headers,
                query: { disableCookieCache: true, disableRefresh: true },
              });
              const signed = await ctx.getSignedCookie(
                ctx.context.createAuthCookie("two_factor").name,
                ctx.context.secret,
              );
              const pending = signed
                ? await ctx.context.internalAdapter.findVerificationValue(
                    signed,
                  )
                : null;
              const userId = current?.user?.id || pending?.value;
              if (userId) {
                const client = await acquire(state, userId);
                if (current?.session?.id) {
                  state.logoutSessionId = current.session.id;
                  await client.query(
                    "DELETE FROM forma_session_assurance WHERE session_id=$1",
                    [current.session.id],
                  );
                }
              }
              return;
            }
            if (credentialPaths.has(ctx.path)) {
              // Lookup selects only a serialization key; the maintained endpoint
              // verifies the credential after this lock, never this lookup.
              if (!state)
                throw new APIError("FORBIDDEN", {
                  code: "MANAGED_HTTP_REQUIRED",
                  message: "Managed HTTP context required",
                });
              let user;
              if (
                ctx.path === "/sign-in/email" &&
                typeof ctx.body?.email === "string"
              )
                user = (
                  await ctx.context.internalAdapter.findUserByEmail(
                    ctx.body.email.toLowerCase(),
                  )
                )?.user;
              if (
                ctx.path === "/sign-in/username" &&
                typeof ctx.body?.username === "string"
              )
                user = await ctx.context.adapter.findOne({
                  model: "user",
                  where: [
                    {
                      field: "username",
                      value: ctx.body.username.toLowerCase(),
                    },
                  ],
                });
              if (user?.id) await acquire(state, user.id);
              return;
            }
            if (mutationPaths.has(ctx.path) || sensitivePaths.has(ctx.path)) {
              if (!state)
                throw new APIError("FORBIDDEN", {
                  code: "MANAGED_HTTP_REQUIRED",
                  message: "Managed HTTP context required",
                });
              let userId;
              if (ctx.path === "/reset-password") {
                if (typeof ctx.body?.token === "string") {
                  const token =
                    await ctx.context.internalAdapter.findVerificationValue(
                      `reset-password:${ctx.body.token}`,
                    );
                  if (token && new Date(token.expiresAt) > new Date())
                    userId = token.value;
                }
              } else
                userId = (
                  await getAuth().api.getSession({
                    headers: ctx.headers,
                    query: { disableCookieCache: true, disableRefresh: true },
                  })
                )?.user?.id;
              if (userId) {
                state.securityUser = userId;
                const client = await acquire(state, userId);
                if (sensitivePaths.has(ctx.path)) {
                  const current = await getAuth().api.getSession({
                    headers: ctx.headers,
                    query: { disableCookieCache: true, disableRefresh: true },
                  });
                  if (
                    !current?.user?.emailVerified ||
                    current.user.id !== userId
                  )
                    throw new APIError("UNAUTHORIZED", {
                      code: "VERIFIED_SESSION_REQUIRED",
                      message: "Verified current session required",
                    });
                  if (
                    (ctx.path !== "/two-factor/get-totp-uri" ||
                      current.user.twoFactorEnabled) &&
                    !(await hasProof(current))
                  )
                    throw new APIError("FORBIDDEN", {
                      code: "CURRENT_MFA_REQUIRED",
                      message: "Current session assurance required",
                    });
                }
                if (mutationPaths.has(ctx.path)) {
                  if (ctx.path !== "/reset-password")
                    await ctx.context.password.checkPassword(userId, {
                      ...ctx,
                      body: {
                        ...ctx.body,
                        password:
                          ctx.path === "/change-password"
                            ? ctx.body.currentPassword
                            : ctx.body.password,
                      },
                    });
                  try {
                    await invalidate(userId, client);
                    state.preInvalidated = true;
                  } catch {
                    await pool
                      .query(
                        "DELETE FROM forma_session_assurance WHERE user_id=$1",
                        [userId],
                      )
                      .catch(() => {});
                    throw new APIError("SERVICE_UNAVAILABLE", {
                      code: "SECURITY_INVALIDATION_UNAVAILABLE",
                      message: "Security state unavailable",
                    });
                  }
                }
              }
              return;
            }
            if (!state)
              throw new APIError("FORBIDDEN", {
                code: "MANAGED_HTTP_REQUIRED",
                message: "Managed HTTP context required",
              });
            let session = await getAuth().api.getSession({
              headers: ctx.headers,
              query: { disableCookieCache: true, disableRefresh: true },
            });
            let userId = session?.user?.id;
            let challengeId;
            if (!userId) {
              const signed = await ctx.getSignedCookie(
                ctx.context.createAuthCookie("two_factor").name,
                ctx.context.secret,
              );
              if (signed) {
                const record =
                  await ctx.context.internalAdapter.findVerificationValue(
                    signed,
                  );
                if (record && new Date(record.expiresAt) > new Date()) {
                  userId = record.value;
                  challengeId = signed;
                }
              }
            }
            if (!userId) return; // Maintained endpoint returns its own credential/challenge denial.
            const client = await acquire(state, userId);
            if (challengeId) {
              const fresh =
                await ctx.context.internalAdapter.findVerificationValue(
                  challengeId,
                );
              if (
                !fresh ||
                fresh.value !== userId ||
                new Date(fresh.expiresAt) <= new Date()
              )
                throw new APIError("UNAUTHORIZED", {
                  code: "INVALID_TWO_FACTOR_COOKIE",
                  message: "Current challenge required",
                });
            } else {
              session = await getAuth().api.getSession({
                headers: ctx.headers,
                query: { disableCookieCache: true, disableRefresh: true },
              });
              if (session?.user?.id !== userId)
                throw new APIError("UNAUTHORIZED", {
                  code: "CURRENT_SESSION_REQUIRED",
                  message: "Current session required",
                });
            }
            await client.query(
              "INSERT INTO forma_user_security(user_id) VALUES($1) ON CONFLICT DO NOTHING",
              [userId],
            );
            const epochs = (
              await client.query(
                "SELECT u.epoch AS user_epoch,p.epoch AS policy_epoch FROM forma_user_security u CROSS JOIN forma_identity_policy p WHERE u.user_id=$1",
                [userId],
              )
            ).rows[0];
            state.factor = {
              userId,
              userEpoch: epochs.user_epoch,
              policyEpoch: epochs.policy_epoch,
              sessionId: session?.session?.id,
              counter: null,
              factorId: null,
            };
            if (ctx.path === "/two-factor/verify-backup-code") {
              const confirmed = (
                await client.query(
                  'SELECT f.verified,u."twoFactorEnabled" FROM "twoFactor" f JOIN "user" u ON u.id=f."userId" WHERE f."userId"=$1',
                  [userId],
                )
              ).rows[0];
              if (
                confirmed?.verified !== true ||
                confirmed.twoFactorEnabled !== true
              )
                throw new APIError("FORBIDDEN", {
                  code: "CONFIRMED_FACTOR_REQUIRED",
                  message:
                    "Authenticator enrollment must be confirmed before recovery",
                });
            }
            if (ctx.path === "/two-factor/verify-totp") {
              const factor = (
                await client.query(
                  'SELECT id,secret FROM "twoFactor" WHERE "userId"=$1',
                  [userId],
                )
              ).rows[0];
              if (!factor) return;
              const raw = await symmetricDecrypt({
                key: ctx.context.secretConfig,
                data: factor.secret,
              });
              const otp = createOTP(raw);
              const input =
                typeof ctx.body?.code === "string"
                  ? Buffer.from(ctx.body.code)
                  : Buffer.alloc(0);
              const current = Math.floor(Date.now() / 30000);
              for (const counter of [current - 1, current, current + 1]) {
                const expected = Buffer.from(await otp.hotp(counter));
                if (
                  input.length === expected.length &&
                  timingSafeEqual(input, expected)
                )
                  state.factor.counter = counter;
              }
              state.factor.factorId = factor.id;
              if (
                state.factor.counter !== null &&
                (
                  await client.query(
                    "SELECT 1 FROM forma_used_totp WHERE user_id=$1 AND factor_id=$2 AND counter=$3",
                    [userId, factor.id, state.factor.counter],
                  )
                ).rowCount
              )
                throw new APIError("CONFLICT", {
                  code: "TOTP_STEP_ALREADY_USED",
                  message: "Authenticator step already used",
                });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) =>
            ctx.path === "/sign-out" ||
            verifiedPaths.has(ctx.path) ||
            [
              "/reset-password",
              "/change-password",
              "/two-factor/disable",
              "/two-factor/generate-backup-codes",
            ].includes(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            if (ctx.path === "/sign-out") {
              const cookie = ctx.context.createAuthCookie("two_factor");
              const signed = await ctx.getSignedCookie(
                cookie.name,
                ctx.context.secret,
              );
              if (signed) {
                await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                  signed,
                );
                await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                  `2fa-attempts-${signed}`,
                );
              }
              expireCookie(ctx, cookie);
              const state = requestState.getStore();
              if (
                state?.logoutSessionId &&
                (
                  await pool.query("SELECT 1 FROM session WHERE id=$1", [
                    state.logoutSessionId,
                  ])
                ).rowCount
              )
                throw new APIError("SERVICE_UNAVAILABLE", {
                  code: "SESSION_REVOCATION_UNAVAILABLE",
                  message: "Logout could not complete session deletion",
                });
              return;
            }
            const state = requestState.getStore();
            if (verifiedPaths.has(ctx.path)) {
              const factor = state?.factor;
              const maintained = ctx.context.newSession?.session;
              const sessionId = maintained?.id || factor?.sessionId;
              if (!factor || !sessionId)
                throw new APIError("FORBIDDEN", {
                  code: "ASSURANCE_BINDING_REQUIRED",
                  message: "Validated session binding required",
                });
              const client = state.factorLock;
              try {
                await client.query("BEGIN");
                await client.query(
                  "INSERT INTO forma_user_security(user_id) VALUES($1) ON CONFLICT DO NOTHING",
                  [factor.userId],
                );
                if (ctx.path === "/two-factor/verify-totp") {
                  if (factor.counter === null)
                    throw new Error("No maintained OTP step matched");
                  await client.query(
                    "INSERT INTO forma_used_totp(user_id,factor_id,counter) VALUES($1,$2,$3)",
                    [factor.userId, factor.factorId, factor.counter],
                  );
                }
                const bound = await client.query(
                  `INSERT INTO forma_session_assurance(session_id,user_id,user_epoch,policy_epoch,method) SELECT s.id,s."userId",u.epoch,p.epoch,$3 FROM session s JOIN forma_user_security u ON u.user_id=s."userId" CROSS JOIN forma_identity_policy p WHERE s.id=$1 AND s."userId"=$2 AND s."expiresAt">NOW() AND u.epoch=$4 AND p.epoch=$5 ON CONFLICT(session_id) DO UPDATE SET user_epoch=EXCLUDED.user_epoch,policy_epoch=EXCLUDED.policy_epoch,method=EXCLUDED.method`,
                  [
                    sessionId,
                    factor.userId,
                    ctx.path.endsWith("verify-totp") ? "totp" : "recovery",
                    factor.userEpoch,
                    factor.policyEpoch,
                  ],
                );
                if (bound.rowCount !== 1)
                  throw new Error("Missing maintained session");
                await client.query("COMMIT");
              } catch {
                await client.query("ROLLBACK").catch(() => {});
                if (maintained?.id)
                  ctx.context.responseHeaders?.delete("set-cookie");
                if (maintained?.id)
                  await pool.query("DELETE FROM session WHERE id=$1", [
                    maintained.id,
                  ]);
                throw new APIError("SERVICE_UNAVAILABLE", {
                  code: "ASSURANCE_UNAVAILABLE",
                  message: "Session assurance unavailable",
                });
              }
            } else {
              const userId = state?.securityUser;
              if (userId && !state.preInvalidated)
                await invalidate(userId, state.factorLock);
            }
          }),
        },
      ],
    },
  };
  async function introspect(cookie) {
    if (
      !organizationId ||
      typeof cookie !== "string" ||
      cookie.length > 8192 ||
      /[\r\n]/.test(cookie)
    )
      return { status: 401 };
    const auth = getAuth(),
      context = await auth.$context,
      name = context.authCookies.sessionToken.name;
    const pairs = cookie
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.split("=", 1)[0] === name);
    if (pairs.length !== 1 || !pairs[0].slice(name.length + 1))
      return { status: 401 };
    const session = await auth.api.getSession({
      headers: new Headers({ Cookie: pairs[0] }),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (
      !session?.user?.emailVerified ||
      !session?.session?.expiresAt ||
      new Date(session.session.expiresAt) <= new Date()
    )
      return { status: 401 };
    const policy = (
      await pool.query(
        "SELECT app_id,organization_id,require_mfa FROM forma_identity_policy WHERE singleton=TRUE",
      )
    ).rows[0];
    if (
      !policy ||
      policy.app_id !== appId ||
      policy.organization_id !== organizationId
    )
      return { status: 403 };
    const proof = await hasProof(session);
    if (typeof permissionPolicy !== "function") return { status: 403 };
    const member = await permissionPolicy({
      userId: session.user.id,
      organizationId,
      pool,
    });
    if (
      !member ||
      !Array.isArray(member.permissions) ||
      !member.permissions.length
    )
      return { status: 403 };
    if (
      (policy.require_mfa ||
        session.user.twoFactorEnabled ||
        member.requiresMfa === true) &&
      !proof
    )
      return { status: 403 };
    return {
      status: 200,
      principal: {
        app_id: appId,
        organization_id: organizationId,
        user_id: session.user.id,
        permissions: [...member.permissions],
        expires_at: new Date(session.session.expiresAt).toISOString(),
        assurance: proof ? "mfa-session-v1" : "basic-session-fixture",
      },
    };
  }
  return {
    plugin,
    initialize,
    hasProof,
    introspect,
    async setMfaPolicy(required) {
      if (typeof required !== "boolean" || (required && !enableTotp))
        throw new Error("Unsupported policy");
      const client = await pool.connect();
      try {
        await client.query("SET lock_timeout='2s'");
        await client.query("SELECT pg_advisory_lock(hashtext($1))", [
          `policy:${appId}`,
        ]);
        await client.query("BEGIN");
        await client.query(
          "UPDATE forma_identity_policy SET require_mfa=$1,epoch=epoch+1 WHERE singleton=TRUE",
          [required],
        );
        await client.query(
          "DELETE FROM verification WHERE identifier LIKE '2fa-%'",
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        try {
          await client.query("SELECT pg_advisory_unlock_all()");
          client.release();
        } catch {
          client.release(true);
        }
      }
    },
    async release() {
      const state = requestState.getStore();
      if (state?.factorLock) {
        const client = state.factorLock;
        delete state.factorLock;
        try {
          await client.query("SELECT pg_advisory_unlock_all()");
          client.release();
        } catch {
          client.release(true);
        }
      }
    },
  };
}
