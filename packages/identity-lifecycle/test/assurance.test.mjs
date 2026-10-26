import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPasswordIdentity } from "../src/identity.mjs";
const execute = promisify(execFileCallback);
const execFile = (command, args) =>
  execute(command, args, { timeout: 15000, maxBuffer: 65536 });
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { identityServer } from "../../identity-boundary/src/server.mjs";
import { fileURLToPath } from "node:url";
test(
  "session-bound MFA assurance protects real Python domain API",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "forma-assurance-"));
    const name = `forma-assurance-${randomBytes(6).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    let identity, server, introspection;
    const children = [];
    t.after(async () => {
      for (const child of children) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
        if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      }
      if (introspection)
        await new Promise((resolve) => introspection.close(resolve));
      if (server) await new Promise((r) => server.close(r));
      if (identity) await identity.close();
      await execFile("docker", ["rm", "-f", name]).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    });
    const env = path.join(directory, "postgres.env");
    await writeFile(
      env,
      `POSTGRES_USER=proof\nPOSTGRES_DB=assurance_proof\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 },
    );
    await execFile("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      name,
      "--env-file",
      env,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,size=256m",
      "--publish",
      "127.0.0.1::5432",
      "--pull",
      "never",
      "postgres:17-bookworm",
    ]);
    const { stdout } = await execFile("docker", ["port", name, "5432/tcp"]);
    const port = Number(stdout.trim().split(":").at(-1));
    server = http.createServer((req, res) => identity.handler(req, res));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const messages = [];
    const deliveryFailures = [];
    let failMail = false;
    const configuration = {
      databaseUrl: `postgres://proof:${password}@127.0.0.1:${port}/assurance_proof`,
      secret: randomBytes(32).toString("hex"),
      appId: "assurance-proof",
      organizationId: "synthetic-org",
      requireMfa: true,
      enableTotp: true,
      publicOrigin: origin,
      verificationExpiresIn: 3600,
      onDeliveryFailure: async (event) => deliveryFailures.push(event),
      sendMail: async (message) => {
        if (failMail) throw new Error("Synthetic delivery unavailable");
        messages.push(message);
      },
    };
    identity = createPasswordIdentity(configuration);
    for (let attempt = 0; ; attempt++) {
      try {
        await identity.pool.query("SELECT 1");
        break;
      } catch (error) {
        if (attempt > 60) throw error;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await identity.initialize();
    async function post(route, body, cookie) {
      return fetch(`${origin}/api/auth/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
    }

    const credentials = {
      email: "assurance@example.test",
      username: "assurance_user",
      name: "Synthetic Assurance",
      password: "Synthetic-assurance-password-81",
    };
    const cookieOf = (response) =>
      response.headers
        .getSetCookie()
        .filter((value) => !value.includes("Max-Age=0"))
        .map((value) => value.split(";")[0])
        .join("; ");
    const clearBudget = () => identity.pool.query('DELETE FROM "rateLimit"');
    const session = async (cookie) =>
      (
        await fetch(`${origin}/api/auth/get-session`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(5000),
        })
      ).json();
    await post("sign-up/email", credentials);
    await fetch(messages[0].url, { redirect: "manual" });
    const first = await post("sign-in/email", credentials);
    assert.equal(first.status, 200);
    const oldCookie = cookieOf(first);
    const second = await post("sign-in/email", credentials);
    assert.equal(second.status, 200);
    let activeCookie = cookieOf(second);
    const userId = (await session(activeCookie)).user.id;
    await identity.pool.query(
      "INSERT INTO identity_memberships(user_id,organization_id,role) VALUES($1,$2,$3)",
      [userId, "synthetic-org", "member"],
    );
    introspection = identityServer(identity);
    await new Promise((resolve) =>
      introspection.listen(0, "127.0.0.1", resolve),
    );
    const identityUrl = `http://127.0.0.1:${introspection.address().port}/internal/identity`;
    const context = await identity.auth.$context;
    async function startDomain(required, databaseName) {
      const python = spawn(
        "python3",
        [
          fileURLToPath(
            new URL(
              "../../identity-boundary/python/protected_api.py",
              import.meta.url,
            ),
          ),
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            PYTHONPATH: "",
            PROOF_REQUIRED_ASSURANCE: required,
            PROOF_IDENTITY_URL: identityUrl,
            PROOF_APP_ID: "assurance-proof",
            PROOF_ORGANIZATION_ID: "synthetic-org",
            PROOF_SESSION_COOKIE_NAME: context.authCookies.sessionToken.name,
            PROOF_PUBLIC_ORIGIN: origin,
            PROOF_DATABASE_PATH: path.join(directory, databaseName),
            PROOF_PORT: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      children.push(python);
      let pythonOutput = "";
      python.stdout.on("data", (chunk) => {
        pythonOutput += chunk;
      });
      python.stderr.on("data", () => {});
      let api;
      for (let attempt = 0; attempt < 200; attempt++) {
        const match = pythonOutput.match(/loopback port ([0-9]+)/);
        if (match) {
          api = `http://127.0.0.1:${match[1]}`;
          break;
        }
        if (python.exitCode !== null)
          throw new Error("Python assurance fixture exited");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(api, "Python assurance fixture starts");
      return api;
    }
    const api = await startDomain("mfa-session-v1", "records.sqlite");
    async function domain(
      cookie,
      {
        method = "GET",
        data,
        origin: writeOrigin,
        headers = {},
        base = api,
      } = {},
    ) {
      return fetch(`${base}/api/records`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(writeOrigin ? { Origin: writeOrigin } : {}),
          ...(data ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout(5000),
      });
    }

    async function withReplica(operation) {
      const replica = createPasswordIdentity(configuration);
      let replicaServer;
      try {
        await replica.initialize();
        replicaServer = http.createServer((req, res) =>
          replica.handler(req, res),
        );
        await new Promise((resolve) =>
          replicaServer.listen(0, "127.0.0.1", resolve),
        );
        const rawPost = (route, body, cookie) =>
          new Promise((resolve, reject) => {
            const bytes = Buffer.from(JSON.stringify(body));
            const request = http.request(
              {
                hostname: "127.0.0.1",
                port: replicaServer.address().port,
                path: `/api/auth/${route}`,
                method: "POST",
                agent: false,
                headers: {
                  Host: new URL(origin).host,
                  Origin: origin,
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "Content-Length": bytes.length,
                },
              },
              (response) => {
                const chunks = [];
                response.on("data", (chunk) => chunks.push(chunk));
                response.on("end", () => {
                  const headers = new Headers();
                  for (const [name, value] of Object.entries(response.headers))
                    for (const item of Array.isArray(value) ? value : [value])
                      if (item !== undefined) headers.append(name, item);
                  resolve(
                    new Response(Buffer.concat(chunks), {
                      status: response.statusCode,
                      headers,
                    }),
                  );
                });
              },
            );
            request.setTimeout(5000, () =>
              request.destroy(new Error("Replica fixture timeout")),
            );
            request.on("error", reject);
            request.end(bytes);
          });
        return await operation(rawPost);
      } finally {
        if (replicaServer) {
          replicaServer.closeAllConnections();
          await new Promise((resolve) => replicaServer.close(resolve));
        }
        await replica.close();
      }
    }
    async function waitQueued(count) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const row = (
          await identity.pool.query(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          )
        ).rows[0];
        if (row.n >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Expected deterministic advisory-lock queue");
    }
    let otp, backupCodes;
    await t.test(
      "pending recovery cannot bypass TOTP confirmation; old basic sessions deny",
      async () => {
        assert.equal((await domain(oldCookie)).status, 403);
        assert.equal(
          (
            await domain(oldCookie, {
              headers: {
                "X-User-Id": userId,
                "X-Role": "admin",
                "X-MFA-Complete": "true",
              },
            })
          ).status,
          403,
        );
        await clearBudget();
        const enabled = await post(
          "two-factor/enable",
          { password: credentials.password },
          activeCookie,
        );
        assert.equal(enabled.status, 200);
        const enrollment = await enabled.json();
        backupCodes = enrollment.backupCodes;
        const pendingBefore = (
          await identity.pool.query(
            'SELECT "backupCodes",verified FROM "twoFactor" WHERE "userId"=$1',
            [userId],
          )
        ).rows[0];
        const premature = await post(
          "two-factor/verify-backup-code",
          { code: backupCodes[0] },
          activeCookie,
        );
        assert.equal(premature.status, 403);
        assert.ok(premature.headers.get("set-cookie") === null);
        const pendingAfter = (
          await identity.pool.query(
            'SELECT "backupCodes",verified FROM "twoFactor" WHERE "userId"=$1',
            [userId],
          )
        ).rows[0];
        assert.ok(pendingBefore.backupCodes === pendingAfter.backupCodes);
        assert.equal(pendingAfter.verified, false);
        assert.equal(
          (
            await identity.pool.query(
              "SELECT count(*)::int AS n FROM forma_session_assurance WHERE user_id=$1",
              [userId],
            )
          ).rows[0].n,
          0,
        );
        assert.equal((await domain(activeCookie)).status, 403);
        otp = createOTP(
          new TextDecoder().decode(
            base32.decode(
              new URL(enrollment.totpURI).searchParams.get("secret"),
            ),
          ),
        );
        const verified = await post(
          "two-factor/verify-totp",
          { code: await otp.totp() },
          activeCookie,
        );
        assert.equal(verified.status, 200);
        activeCookie = cookieOf(verified);
        assert.equal((await domain(activeCookie)).status, 200);
        assert.ok(await session(oldCookie));
        assert.equal((await domain(oldCookie)).status, 403);
        for (const route of [
          "two-factor/generate-backup-codes",
          "two-factor/disable",
        ])
          assert.equal(
            (await post(route, { password: credentials.password }, oldCookie))
              .status,
            403,
          );
        const repeated = await post(
          "two-factor/verify-totp",
          { code: await otp.totp() },
          oldCookie,
        );
        assert.equal(repeated.status, 409);
        assert.ok(await session(oldCookie));
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    async function challenge() {
      await clearBudget();
      const response = await post("sign-in/email", credentials);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).twoFactorRedirect, true);
      const cookie = cookieOf(response);
      assert.ok((await session(cookie)) === null);
      return cookie;
    }
    async function recover() {
      const cookie = await challenge();
      const result = await post(
        "two-factor/verify-backup-code",
        { code: backupCodes.shift() },
        cookie,
      );
      assert.equal(result.status, 200);
      return cookieOf(result);
    }
    await t.test(
      "cross-challenge same TOTP counter has one winner and no extra session",
      async () => {
        const firstChallenge = await challenge(),
          secondChallenge = await challenge();
        const used = new Set(
          (
            await identity.pool.query(
              "SELECT counter::text FROM forma_used_totp",
            )
          ).rows.map((row) => row.counter),
        );
        const current = Math.floor(Date.now() / 30000);
        const counter = [current, current + 1, current - 1].find(
          (counter) => !used.has(String(counter)),
        );
        assert.ok(counter !== undefined);
        const code = await otp.hotp(counter);
        const replica = createPasswordIdentity(configuration);
        let replicaServer;
        let results;
        try {
          await replica.initialize();
          replicaServer = http.createServer((req, res) =>
            replica.handler(req, res),
          );
          await new Promise((resolve) =>
            replicaServer.listen(0, "127.0.0.1", resolve),
          );
          results = await Promise.all([
            post("two-factor/verify-totp", { code }, firstChallenge),
            new Promise((resolve, reject) => {
              const bytes = Buffer.from(JSON.stringify({ code }));
              const request = http.request(
                {
                  hostname: "127.0.0.1",
                  port: replicaServer.address().port,
                  path: "/api/auth/two-factor/verify-totp",
                  method: "POST",
                  agent: false,
                  headers: {
                    Host: new URL(origin).host,
                    Origin: origin,
                    Cookie: secondChallenge,
                    "Content-Type": "application/json",
                    "Content-Length": bytes.length,
                  },
                },
                (response) => {
                  const chunks = [];
                  response.on("data", (chunk) => chunks.push(chunk));
                  response.on("end", () => {
                    const headers = new Headers();
                    for (const [name, value] of Object.entries(
                      response.headers,
                    ))
                      for (const item of Array.isArray(value) ? value : [value])
                        if (item !== undefined) headers.append(name, item);
                    resolve(
                      new Response(Buffer.concat(chunks), {
                        status: response.statusCode,
                        headers,
                      }),
                    );
                  });
                },
              );
              request.setTimeout(5000, () =>
                request.destroy(new Error("Replica fixture timeout")),
              );
              request.on("error", reject);
              request.end(bytes);
            }),
          ]);
        } finally {
          if (replicaServer) {
            replicaServer.closeAllConnections();
            await new Promise((resolve) => replicaServer.close(resolve));
          }
          await replica.close();
        }
        assert.equal(
          results.filter((result) => result.status === 200).length,
          1,
        );
        assert.equal(
          results.filter((result) => result.status === 409).length,
          1,
          JSON.stringify(results.map((result) => result.status)),
        );
        const loser = results.find((result) => result.status === 409);
        assert.ok(loser.headers.get("set-cookie") === null);
        const winner = results.find((result) => result.status === 200);
        assert.equal((await domain(cookieOf(winner))).status, 200);
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "server role, organization, owner and write Origin remain authoritative",
      async () => {
        assert.equal(
          (
            await domain(activeCookie, {
              method: "POST",
              data: { title: "Synthetic work" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await domain(activeCookie, {
              method: "POST",
              origin: "https://foreign.example",
              data: { title: "Synthetic work" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await domain(activeCookie, {
              method: "POST",
              origin,
              data: { title: "Synthetic work", owner_user_id: "forged" },
            })
          ).status,
          400,
        );
        const created = await domain(activeCookie, {
          method: "POST",
          origin,
          data: { title: "Synthetic work" },
        });
        assert.equal(created.status, 201);
        await identity.pool.query(
          "UPDATE identity_memberships SET role=$1 WHERE user_id=$2",
          ["viewer", userId],
        );
        assert.equal(
          (
            await domain(activeCookie, {
              method: "POST",
              origin,
              data: { title: "Denied" },
              headers: { "X-Role": "admin" },
            })
          ).status,
          403,
        );
        await identity.pool.query(
          "UPDATE identity_memberships SET organization_id=$1 WHERE user_id=$2",
          ["other-org", userId],
        );
        assert.equal((await domain(activeCookie)).status, 403);
        await identity.pool.query(
          "UPDATE identity_memberships SET organization_id=$1,role=$2 WHERE user_id=$3",
          ["synthetic-org", "member", userId],
        );
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "forwarded IP headers cannot create independent credential rate buckets",
      async () => {
        await clearBudget();
        const statuses = [];
        for (let index = 0; index < 5; index++) {
          const response = await fetch(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: origin,
              "X-Forwarded-For": `192.0.2.${index + 1}`,
              "X-Real-IP": `198.51.100.${index + 1}`,
              "CF-Connecting-IP": `203.0.113.${index + 1}`,
              "X-Forma-Socket-IP": `192.0.2.${index + 10}`,
            },
            body: JSON.stringify({
              email: credentials.email,
              password: "Wrong-synthetic-password",
            }),
            signal: AbortSignal.timeout(5000),
          });
          statuses.push(response.status);
        }
        assert.ok(statuses.includes(429));
        assert.ok(statuses.every((status) => status === 401 || status === 429));
      },
    );
    await t.test(
      "scope and enrolled-security downgrades refuse startup",
      async () => {
        for (const patch of [
          { enableTotp: false, requireMfa: false },
          { appId: "wrong-app" },
          { organizationId: "wrong-org" },
          { requireMfa: false },
        ]) {
          const candidate = createPasswordIdentity({
            ...configuration,
            ...patch,
          });
          try {
            await assert.rejects(
              () => candidate.initialize(),
              /scope|policy|downgrade/,
            );
          } finally {
            await candidate.close();
          }
        }
      },
    );
    await t.test(
      "live persisted scope drift denies until corrected",
      async () => {
        await identity.pool.query(
          "UPDATE forma_identity_policy SET organization_id=$1",
          ["unexpected-org"],
        );
        try {
          assert.equal((await domain(activeCookie)).status, 403);
          assert.equal(
            (
              await post(
                "two-factor/disable",
                { password: credentials.password },
                activeCookie,
              )
            ).status,
            403,
          );
        } finally {
          await identity.pool.query(
            "UPDATE forma_identity_policy SET organization_id=$1",
            ["synthetic-org"],
          );
        }
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );

    await t.test(
      "queued independent sensitive requests recheck proof after rotation",
      async () => {
        for (const secondRoute of [
          "two-factor/disable",
          "two-factor/get-totp-uri",
        ]) {
          await withReplica(async (rawPost) => {
            const blocker = await identity.pool.connect();
            await blocker.query("SELECT pg_advisory_lock(hashtext($1))", [
              `factor:${userId}`,
            ]);
            let rotation, second;
            try {
              rotation = post(
                "two-factor/generate-backup-codes",
                { password: credentials.password },
                activeCookie,
              );
              await waitQueued(1);
              second = rawPost(
                secondRoute,
                { password: credentials.password },
                activeCookie,
              );
              await waitQueued(2);
            } finally {
              await blocker.query("SELECT pg_advisory_unlock_all()");
              blocker.release();
            }
            const [rotated, denied] = await Promise.all([rotation, second]);
            assert.equal(rotated.status, 200);
            assert.equal(denied.status, 403);
            backupCodes = (await rotated.json()).backupCodes;
            assert.equal(
              (
                await identity.pool.query(
                  'SELECT "twoFactorEnabled" FROM "user" WHERE id=$1',
                  [userId],
                )
              ).rows[0].twoFactorEnabled,
              true,
            );
            assert.equal((await domain(activeCookie)).status, 403);
          });
          activeCookie = await recover();
          assert.equal((await domain(activeCookie)).status, 200);
        }
      },
    );
    await t.test(
      "failed epoch invalidation cannot mutate factors or preserve prior authority",
      async () => {
        const before = (
          await identity.pool.query(
            'SELECT "backupCodes",verified FROM "twoFactor" WHERE "userId"=$1',
            [userId],
          )
        ).rows[0];
        await identity.pool.query(
          `CREATE FUNCTION fail_security_epoch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic epoch failure'; END $$;CREATE TRIGGER fail_security_epoch BEFORE UPDATE ON forma_user_security FOR EACH ROW EXECUTE FUNCTION fail_security_epoch()`,
        );
        try {
          const failed = await post(
            "two-factor/generate-backup-codes",
            { password: credentials.password },
            activeCookie,
          );
          assert.equal(failed.status, 503);
          assert.equal((await domain(activeCookie)).status, 403);
          const after = (
            await identity.pool.query(
              'SELECT "backupCodes",verified FROM "twoFactor" WHERE "userId"=$1',
              [userId],
            )
          ).rows[0];
          assert.ok(before.backupCodes === after.backupCodes);
          assert.equal(after.verified, true);
        } finally {
          await identity.pool.query(
            "DROP TRIGGER fail_security_epoch ON forma_user_security;DROP FUNCTION fail_security_epoch()",
          );
        }
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "policy epoch invalidates proofs and outstanding password challenges",
      async () => {
        const pending = await challenge();
        await identity.setMfaPolicy(false);
        assert.equal((await domain(activeCookie)).status, 403);
        assert.equal(
          (
            await post(
              "two-factor/verify-backup-code",
              { code: backupCodes[0] },
              pending,
            )
          ).status,
          401,
        );
        await identity.setMfaPolicy(true);
        assert.equal((await domain(activeCookie)).status, 403);
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );

    await t.test(
      "optional policy still requires MFA for enrolled users and privileged admins",
      async () => {
        await identity.setMfaPolicy(false);
        const optionalApi = await startDomain(
          "basic-session-fixture",
          "optional.sqlite",
        );
        try {
          assert.equal(
            (await domain(oldCookie, { base: optionalApi })).status,
            403,
          );
          activeCookie = await recover();
          assert.equal(
            (await domain(activeCookie, { base: optionalApi })).status,
            200,
          );
          const account = {
            ...credentials,
            email: "optional@example.test",
            username: "optional_user",
          };
          await clearBudget();
          assert.equal((await post("sign-up/email", account)).status, 200);
          await fetch(
            messages.findLast(
              (message) =>
                message.kind === "verification" && message.to === account.email,
            ).url,
            { redirect: "manual" },
          );
          const signed = await post("sign-in/email", account);
          assert.equal(signed.status, 200);
          const basic = cookieOf(signed),
            principal = await session(basic);
          await identity.pool.query(
            "INSERT INTO identity_memberships(user_id,organization_id,role) VALUES($1,$2,$3)",
            [principal.user.id, "synthetic-org", "member"],
          );
          assert.equal(
            (await domain(basic, { base: optionalApi })).status,
            200,
          );
          await identity.pool.query(
            "UPDATE identity_memberships SET role=$1 WHERE user_id=$2",
            ["admin", principal.user.id],
          );
          assert.equal(
            (await domain(basic, { base: optionalApi })).status,
            403,
          );
        } finally {
          await identity.setMfaPolicy(true);
        }
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "recovery rotation invalidates old session assurance until a new challenge",
      async () => {
        const rotated = await post(
          "two-factor/generate-backup-codes",
          { password: credentials.password },
          activeCookie,
        );
        assert.equal(rotated.status, 200);
        backupCodes = (await rotated.json()).backupCodes;
        assert.ok(await session(activeCookie));
        assert.equal((await domain(activeCookie)).status, 403);
        assert.equal(
          (
            await post(
              "two-factor/disable",
              { password: credentials.password },
              activeCookie,
            )
          ).status,
          403,
        );
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );

    await t.test(
      "queued factor cannot authenticate a challenge invalidated by password reset",
      async () => {
        const pending = await challenge();
        await post("request-password-reset", {
          email: credentials.email,
          redirectTo: `${origin}/reset`,
        });
        const token = messages.findLast(
          (message) => message.kind === "reset",
        ).token;
        const blocker = await identity.pool.connect();
        await blocker.query("SELECT pg_advisory_lock(hashtext($1))", [
          `factor:${userId}`,
        ]);
        let reset, verify;
        try {
          reset = post("reset-password", {
            token,
            newPassword: "Queued-reset-assurance-password-84",
          });
          await waitQueued(1);
          verify = post(
            "two-factor/verify-backup-code",
            { code: backupCodes[0] },
            pending,
          );
          await waitQueued(2);
        } finally {
          await blocker.query("SELECT pg_advisory_unlock_all()");
          blocker.release();
        }
        const [resetResult, denied] = await Promise.all([reset, verify]);
        assert.equal(resetResult.status, 200);
        credentials.password = "Queued-reset-assurance-password-84";
        assert.equal(denied.status, 401);
        assert.ok(denied.headers.get("set-cookie") === null);
        assert.ok((await session(pending)) === null);
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "queued old-password sign-in cannot issue a challenge after password reset",
      async () => {
        await clearBudget();
        await post("request-password-reset", {
          email: credentials.email,
          redirectTo: `${origin}/reset`,
        });
        const token = messages.findLast(
          (message) => message.kind === "reset",
        ).token;
        const blocker = await identity.pool.connect();
        await blocker.query("SELECT pg_advisory_lock(hashtext($1))", [
          `factor:${userId}`,
        ]);
        let reset, signin;
        try {
          reset = post("reset-password", {
            token,
            newPassword: "Serialized-assurance-password-85",
          });
          await waitQueued(1);
          signin = post("sign-in/email", { ...credentials });
          await waitQueued(2);
        } finally {
          await blocker.query("SELECT pg_advisory_unlock_all()");
          blocker.release();
        }
        const [changed, denied] = await Promise.all([reset, signin]);
        assert.equal(changed.status, 200);
        credentials.password = "Serialized-assurance-password-85";
        assert.equal(denied.status, 401);
        assert.ok(denied.headers.get("set-cookie") === null);
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "password change and reset require new assurance and erase pending challenges",
      async () => {
        const beforeChange = activeCookie;
        const changed = await post(
          "change-password",
          {
            currentPassword: credentials.password,
            newPassword: "Changed-assurance-password-82",
            revokeOtherSessions: true,
          },
          activeCookie,
        );
        assert.equal(changed.status, 200);
        credentials.password = "Changed-assurance-password-82";
        assert.equal((await domain(beforeChange)).status, 401);
        assert.equal((await domain(cookieOf(changed))).status, 403);
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
        const pending = await challenge();
        await post("request-password-reset", {
          email: credentials.email,
          redirectTo: `${origin}/reset`,
        });
        const token = messages.findLast(
          (message) => message.kind === "reset",
        ).token;
        const reset = await post("reset-password", {
          token,
          newPassword: "Reset-assurance-password-83",
        });
        assert.equal(reset.status, 200);
        credentials.password = "Reset-assurance-password-83";
        assert.equal((await domain(activeCookie)).status, 401);
        assert.equal(
          (
            await post(
              "two-factor/verify-backup-code",
              { code: backupCodes[0] },
              pending,
            )
          ).status,
          401,
        );
        activeCookie = await recover();
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "query failure is fail closed; failed new proof cannot leave usable session",
      async () => {
        const cookie = await challenge();
        await identity.pool.query(
          "ALTER TABLE forma_session_assurance RENAME TO unavailable_assurance",
        );
        try {
          assert.equal((await domain(activeCookie)).status, 503);
          const failed = await post(
            "two-factor/verify-backup-code",
            { code: backupCodes.shift() },
            cookie,
          );
          assert.equal(failed.status, 503);
          assert.ok(failed.headers.get("set-cookie") === null);
          assert.ok((await session(cookie)) === null);
        } finally {
          await identity.pool.query(
            "ALTER TABLE unavailable_assurance RENAME TO forma_session_assurance",
          );
        }
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "disabling creates no MFA-authorized session and reenrollment needs fresh proof",
      async () => {
        const disabled = await post(
          "two-factor/disable",
          { password: credentials.password },
          activeCookie,
        );
        assert.equal(disabled.status, 200);
        assert.equal((await domain(cookieOf(disabled))).status, 403);
        await clearBudget();
        const plain = await post("sign-in/email", credentials);
        assert.equal(plain.status, 200);
        const basic = cookieOf(plain);
        assert.ok(await session(basic));
        assert.equal((await domain(basic)).status, 403);
        const enabled = await post(
          "two-factor/enable",
          { password: credentials.password },
          basic,
        );
        assert.equal(enabled.status, 200);
        const enrollment = await enabled.json();
        backupCodes = enrollment.backupCodes;
        otp = createOTP(
          new TextDecoder().decode(
            base32.decode(
              new URL(enrollment.totpURI).searchParams.get("secret"),
            ),
          ),
        );
        const verified = await post(
          "two-factor/verify-totp",
          { code: await otp.totp() },
          basic,
        );
        assert.equal(verified.status, 200);
        activeCookie = cookieOf(verified);
        assert.equal((await domain(activeCookie)).status, 200);
      },
    );
    await t.test(
      "revocation removes protected access immediately",
      async () => {
        assert.equal((await post("sign-out", {}, activeCookie)).status, 200);
        assert.equal((await domain(activeCookie)).status, 401);
      },
    );
  },
);
