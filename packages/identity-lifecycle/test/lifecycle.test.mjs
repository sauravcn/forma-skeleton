import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPasswordIdentity } from "../src/identity.mjs";
const execute = promisify(execFileCallback);
const execFile = (command, args) =>
  execute(command, args, { timeout: 15000, maxBuffer: 65536 });
test("configuration rejects missing transport and ambient database fallback", () => {
  assert.throws(() => createPasswordIdentity({}), /mail transport/);
  assert.throws(() => createPasswordIdentity({ sendMail() {} }), /PostgreSQL/);
  assert.throws(
    () =>
      createPasswordIdentity({
        sendMail() {},
        databaseUrl: "postgres://proof:synthetic@127.0.0.1:5432/proof",
      }),
    /reporter/,
  );
});
test("zero and missing database ports reject before constructing pools", () => {
  const config = {
    sendMail() {},
    onDeliveryFailure() {},
    secret: "synthetic-secret-of-at-least-32-characters",
    appId: "guard-proof",
    publicOrigin: "http://127.0.0.1:3000",
  };
  for (const databaseUrl of [
    "postgres://proof:synthetic@127.0.0.1:0/proof",
    "postgres://proof:synthetic@127.0.0.1/proof",
  ])
    assert.throws(
      () => createPasswordIdentity({ ...config, databaseUrl }),
      /credentials, port and database/,
    );
});
test(
  "actual maintained HTTP password lifecycle on isolated PostgreSQL",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "forma-lifecycle-"));
    const name = `forma-lifecycle-${randomBytes(6).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    let identity, server;
    t.after(async () => {
      if (server) await new Promise((r) => server.close(r));
      if (identity) await identity.close();
      await execFile("docker", ["rm", "-f", name]).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    });
    const env = path.join(directory, "postgres.env");
    await writeFile(
      env,
      `POSTGRES_USER=proof\nPOSTGRES_DB=lifecycle_proof\nPOSTGRES_PASSWORD=${password}\n`,
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
    identity = createPasswordIdentity({
      databaseUrl: `postgres://proof:${password}@127.0.0.1:${port}/lifecycle_proof`,
      secret: randomBytes(32).toString("hex"),
      appId: "lifecycle-proof",
      publicOrigin: origin,
      verificationExpiresIn: 2,
      onDeliveryFailure: async (event) => deliveryFailures.push(event),
      sendMail: async (message) => {
        if (failMail) throw new Error("Synthetic delivery unavailable");
        messages.push(message);
      },
    });
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
      email: "alpha@example.test",
      username: "Alpha_User",
      name: "Alpha",
      password: "Synthetic-long-password-47",
    };
    const signup = await post("sign-up/email", credentials);
    assert.equal(signup.status, 200);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, "verification");
    assert.equal((await post("sign-in/email", credentials)).status, 403);
    const verified = await fetch(messages[0].url, { redirect: "manual" });
    assert.ok(verified.status < 400);
    const signin = await post("sign-in/email", credentials);
    assert.equal(signin.status, 200);
    const sessionCookie = signin.headers
      .getSetCookie()
      .find((value) => value.includes(".session_token="));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Lax/i);
    const cookie = signin.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    const stored = await identity.pool.query("SELECT password FROM account");
    assert.notEqual(stored.rows[0].password, credentials.password);
    assert.ok(stored.rows[0].password.length > 64);
    const context = await identity.auth.$context;
    assert.equal(
      await context.password.verify({
        hash: stored.rows[0].password,
        password: credentials.password,
      }),
      true,
    );
    const users = await identity.pool.query(
      'SELECT username,email FROM "user"',
    );
    assert.equal(users.rows[0].username, "alpha_user");
    const duplicate = await post("sign-up/email", {
      ...credentials,
      email: "ALPHA@example.test",
      username: "other_user",
    });
    assert.equal(duplicate.status, 200);
    assert.equal(
      (await identity.pool.query('SELECT count(*)::int n FROM "user"')).rows[0]
        .n,
      1,
    );
    const hostile = await fetch(`${origin}/api/auth/request-password-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://foreign.example",
      },
      body: JSON.stringify({ email: credentials.email }),
    });
    assert.equal(hostile.status, 403);
    const reset = await post("request-password-reset", {
      email: credentials.email,
      redirectTo: `${origin}/reset`,
    });
    const unknown = await post("request-password-reset", {
      email: "missing@example.test",
      redirectTo: `${origin}/reset`,
    });
    assert.equal(reset.status, 200);
    assert.deepEqual(await reset.json(), await unknown.json());
    const token = messages.findLast((m) => m.kind === "reset").token;
    await identity.pool.query(
      "UPDATE verification SET \"expiresAt\"=NOW()-interval '1 minute' WHERE identifier=$1",
      [`reset-password:${token}`],
    );
    assert.equal(
      (
        await post("reset-password", {
          token,
          newPassword: "Replacement-long-password-48",
        })
      ).status,
      400,
    );
    await post("request-password-reset", {
      email: credentials.email,
      redirectTo: `${origin}/reset`,
    });
    const fresh = messages.findLast((m) => m.kind === "reset").token;
    assert.equal(
      (
        await post("reset-password", {
          token: fresh,
          newPassword: "Replacement-long-password-48",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("reset-password", {
          token: fresh,
          newPassword: "Another-long-password-49",
        })
      ).status,
      400,
    );
    assert.equal(
      (await identity.pool.query("SELECT count(*)::int n FROM session")).rows[0]
        .n,
      0,
    );
    assert.equal((await post("sign-in/email", credentials)).status, 401);
    assert.equal(
      (
        await post("sign-in/username", {
          username: "ALPHA_USER",
          password: "Replacement-long-password-48",
        })
      ).status,
      200,
    );
    const sessionResponse = await fetch(`${origin}/api/auth/get-session`, {
      headers: { Cookie: cookie },
    });
    assert.equal(await sessionResponse.json(), null);
    const concurrent = await Promise.all(
      ["same_user", "SAME_USER"].map((username, index) =>
        post("sign-up/email", {
          ...credentials,
          email: `parallel${index}@example.test`,
          username,
        }),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === 200).length, 1);
    assert.equal(
      (
        await identity.pool.query(
          'SELECT count(*)::int n FROM "user" WHERE username=$1',
          ["same_user"],
        )
      ).rows[0].n,
      1,
    );
    // Isolate uniqueness race from the maintained credential-route request budget.
    await identity.pool.query('DELETE FROM "rateLimit"');
    const sameEmail = await Promise.all(
      ["case@example.test", "CASE@example.test"].map((email, index) =>
        post("sign-up/email", {
          ...credentials,
          email,
          username: `unique_user_${index}`,
        }),
      ),
    );
    assert.ok(sameEmail.some((response) => response.status === 200));
    assert.ok(sameEmail.every((response) => response.status === 200));
    assert.deepEqual(await sameEmail[0].json(), await sameEmail[1].json());
    assert.equal(
      (
        await identity.pool.query(
          'SELECT count(*)::int n FROM "user" WHERE email=$1',
          ["case@example.test"],
        )
      ).rows[0].n,
      1,
    );
    const missingOrigin = await fetch(
      `${origin}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email }),
      },
    );
    assert.equal(missingOrigin.status, 403);
    await t.test("unknown and wrong-password responses match", async () => {
      await identity.pool.query('DELETE FROM "rateLimit"');
      const wrong = await post("sign-in/email", {
        email: credentials.email,
        password: "Definitely-wrong-password",
      });
      const unknown = await post("sign-in/email", {
        email: "unknown@example.test",
        password: "Definitely-wrong-password",
      });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.deepEqual(await wrong.json(), await unknown.json());
    });
    await t.test(
      "mail failure cannot verify or authenticate signup; resend recovers",
      async () => {
        await identity.pool.query('DELETE FROM "rateLimit"');
        failMail = true;
        const candidate = {
          ...credentials,
          email: "delivery@example.test",
          username: "delivery_user",
        };
        const failed = await post("sign-up/email", candidate);
        assert.equal(failed.status, 200);
        assert.deepEqual(await failed.json(), {
          status: true,
          message: "Check your inbox if eligible",
        });
        const duplicateDuringOutage = await post("sign-up/email", {
          ...credentials,
          username: "outage_new_user",
        });
        assert.equal(duplicateDuringOutage.status, 200);
        assert.deepEqual(await duplicateDuringOutage.json(), {
          status: true,
          message: "Check your inbox if eligible",
        });
        assert.deepEqual(deliveryFailures.at(-1), {
          kind: "verification",
          code: "MAIL_TRANSPORT_FAILED",
        });
        assert.equal(failed.headers.get("set-cookie"), null);
        const existingReset = await post("request-password-reset", {
          email: candidate.email,
          redirectTo: `${origin}/reset`,
        });
        const unknownReset = await post("request-password-reset", {
          email: "outage-unknown@example.test",
          redirectTo: `${origin}/reset`,
        });
        assert.equal(existingReset.status, 200);
        assert.equal(unknownReset.status, 200);
        assert.deepEqual(await existingReset.json(), await unknownReset.json());
        const existingResend = await post("send-verification-email", {
          email: candidate.email,
          callbackURL: origin,
        });
        const unknownResend = await post("send-verification-email", {
          email: "outage-unknown@example.test",
          callbackURL: origin,
        });
        assert.equal(existingResend.status, 200);
        assert.equal(unknownResend.status, 200);
        assert.deepEqual(
          await existingResend.json(),
          await unknownResend.json(),
        );
        assert.ok(
          deliveryFailures.every(
            (event) => Object.keys(event).sort().join(",") === "code,kind",
          ),
        );
        failMail = false;
        await identity.pool.query('DELETE FROM "rateLimit"');
        const row = await identity.pool.query(
          'SELECT "emailVerified" FROM "user" WHERE email=$1',
          [candidate.email],
        );
        if (row.rows.length) assert.equal(row.rows[0].emailVerified, false);
        assert.equal((await post("sign-in/email", candidate)).status, 403);
        const resend = await post("send-verification-email", {
          email: candidate.email,
          callbackURL: origin,
        });
        assert.equal(resend.status, 200);
        const expired = messages.findLast(
          (m) => m.to === candidate.email && m.kind === "verification",
        );
        assert.ok(expired);
        await new Promise((resolve) => setTimeout(resolve, 2100));
        const expiredResult = await fetch(expired.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        assert.ok(
          expiredResult.status >= 400 ||
            expiredResult.headers.get("location")?.includes("error="),
        );
        assert.equal((await post("sign-in/email", candidate)).status, 403);
        assert.equal(
          (
            await post("send-verification-email", {
              email: candidate.email,
              callbackURL: origin,
            })
          ).status,
          200,
        );
        const fresh = messages.findLast(
          (m) => m.to === candidate.email && m.kind === "verification",
        );
        const verify = await fetch(fresh.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        assert.ok(verify.status < 400);
        const replay = await fetch(fresh.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        assert.ok(replay.status < 400);
        assert.equal(replay.headers.get("set-cookie"), null);
        assert.equal(
          (
            await identity.pool.query(
              'SELECT count(*)::int n FROM session WHERE "userId"=(SELECT id FROM "user" WHERE email=$1)',
              [candidate.email],
            )
          ).rows[0].n,
          0,
        );
        assert.equal((await post("sign-in/email", candidate)).status, 200);
      },
    );
    await t.test(
      "signup guard preserves invalid-input errors and times out held email lock",
      async () => {
        await identity.pool.query('DELETE FROM "rateLimit"');
        const bad = await post("sign-up/email", {
          ...credentials,
          email: "invalid-password@example.test",
          username: "invalid_user",
          password: "short",
        });
        assert.ok(bad.status >= 400 && bad.status < 500);
        const oversized = await post("sign-up/email", {
          ...credentials,
          name: "x".repeat(17000),
        });
        assert.equal(oversized.status, 413);
        const blocker = await identity.pool.connect();
        const blockedEmail = "blocked@example.test";
        try {
          await blocker.query("SELECT pg_advisory_lock(hashtext($1))", [
            blockedEmail,
          ]);
          const blocked = await post("sign-up/email", {
            ...credentials,
            email: blockedEmail,
            username: "blocked_user",
          });
          assert.equal(blocked.status, 503);
          assert.deepEqual(await blocked.json(), {
            code: "IDENTITY_UNAVAILABLE",
          });
          assert.equal(
            (
              await identity.pool.query(
                'SELECT count(*)::int n FROM "user" WHERE email=$1',
                [blockedEmail],
              )
            ).rows[0].n,
            0,
          );
        } finally {
          await blocker.query("SELECT pg_advisory_unlock_all()");
          blocker.release();
        }
        assert.equal(
          (
            await post("sign-up/email", {
              ...credentials,
              email: blockedEmail,
              username: "blocked_user",
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "password change verifies current password and revokes other sessions",
      async () => {
        await identity.pool.query('DELETE FROM "rateLimit"');
        const currentPassword = "Replacement-long-password-48";
        const cookies = (response) =>
          response.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; ");
        const first = await post("sign-in/email", {
          email: credentials.email,
          password: currentPassword,
        });
        assert.equal(first.status, 200);
        const second = await post("sign-in/email", {
          email: credentials.email,
          password: currentPassword,
        });
        assert.equal(second.status, 200);
        const firstCookie = cookies(first),
          secondCookie = cookies(second);
        const session = async (cookie) =>
          (
            await fetch(`${origin}/api/auth/get-session`, {
              headers: { Cookie: cookie },
              signal: AbortSignal.timeout(5000),
            })
          ).json();
        const wrong = await post(
          "change-password",
          {
            currentPassword: "Incorrect-current-password",
            newPassword: "Changed-long-password-50",
            revokeOtherSessions: true,
          },
          firstCookie,
        );
        assert.equal(wrong.status, 400);
        assert.ok(await session(firstCookie));
        assert.ok(await session(secondCookie));
        const changed = await post(
          "change-password",
          {
            currentPassword,
            newPassword: "Changed-long-password-50",
            revokeOtherSessions: true,
          },
          firstCookie,
        );
        assert.equal(changed.status, 200);
        const changedCookie = cookies(changed);
        assert.ok(changedCookie);
        assert.equal(await session(firstCookie), null);
        assert.equal(await session(secondCookie), null);
        assert.ok(await session(changedCookie));
        assert.equal(
          (
            await post("sign-in/email", {
              email: credentials.email,
              password: currentPassword,
            })
          ).status,
          401,
        );
        await identity.pool.query('DELETE FROM "rateLimit"');
        const another = await post("sign-in/email", {
          email: credentials.email,
          password: "Changed-long-password-50",
        });
        assert.equal(another.status, 200);
        assert.equal(
          (await post("revoke-other-sessions", {}, changedCookie)).status,
          200,
        );
        assert.ok(await session(changedCookie));
        assert.equal(await session(cookies(another)), null);
        assert.equal((await post("revoke-other-sessions", {})).status, 401);
      },
    );
  },
);
