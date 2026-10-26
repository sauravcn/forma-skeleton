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
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
test(
  "maintained TOTP enrollment and challenge on isolated PostgreSQL",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "forma-totp-"));
    const name = `forma-totp-${randomBytes(6).toString("hex")}`;
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
      `POSTGRES_USER=proof\nPOSTGRES_DB=totp_proof\nPOSTGRES_PASSWORD=${password}\n`,
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
      databaseUrl: `postgres://proof:${password}@127.0.0.1:${port}/totp_proof`,
      secret: randomBytes(32).toString("hex"),
      appId: "totp-proof",
      enableTotp: true,
      publicOrigin: origin,
      verificationExpiresIn: 3600,
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
      email: "totp@example.test",
      username: "totp_user",
      name: "Synthetic Totp",
      password: "Synthetic-totp-password-73",
    };
    const cookieOf = (response) =>
      response.headers
        .getSetCookie()
        .filter((value) => !value.includes("Max-Age=0"))
        .map((value) => value.split(";")[0])
        .join("; ");
    const session = async (cookie) =>
      (
        await fetch(`${origin}/api/auth/get-session`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(5000),
        })
      ).json();
    const clearBudget = () => identity.pool.query('DELETE FROM "rateLimit"');
    await post("sign-up/email", credentials);
    assert.ok(
      (await fetch(messages[0].url, { redirect: "manual" })).status < 400,
    );
    const signed = await post("sign-in/email", credentials);
    assert.equal(signed.status, 200);
    let activeCookie = cookieOf(signed);
    let otp, backupCodes;
    await t.test(
      "password-required enrollment is pending until authenticator proof",
      async () => {
        assert.equal(
          (await post("two-factor/enable", {}, activeCookie)).status,
          400,
        );
        assert.equal(
          (
            await post(
              "two-factor/enable",
              { password: "wrong-current-password" },
              activeCookie,
            )
          ).status,
          400,
        );
        await identity.pool.query(
          'UPDATE "user" SET "emailVerified"=false WHERE email=$1',
          [credentials.email],
        );
        assert.equal(
          (
            await post(
              "two-factor/enable",
              { password: credentials.password },
              activeCookie,
            )
          ).status,
          401,
        );
        await identity.pool.query(
          'UPDATE "user" SET "emailVerified"=true WHERE email=$1',
          [credentials.email],
        );
        assert.equal(
          (await post("totp/generate", { secret: "synthetic-not-real" }))
            .status,
          404,
        );
        assert.equal(
          (
            await post(
              "two-factor/enable?skipVerification=true",
              { password: credentials.password },
              activeCookie,
            )
          ).status,
          400,
        );
        for (const body of [
          { password: credentials.password, skipVerification: true },
          { password: credentials.password, method: "otp" },
          { password: credentials.password, skipVerificationOnEnable: true },
        ])
          assert.equal(
            (await post("two-factor/enable", body, activeCookie)).status,
            400,
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
        assert.equal(backupCodes.length, 10);
        const encoded = new URL(enrollment.totpURI).searchParams.get("secret");
        const secret = new TextDecoder().decode(base32.decode(encoded));
        otp = createOTP(secret);
        const stored = await identity.pool.query(
          'SELECT secret,"backupCodes",verified FROM "twoFactor"',
        );
        assert.ok(stored.rows[0].secret !== secret);
        assert.ok(!stored.rows[0].backupCodes.includes(backupCodes[0]));
        assert.equal(stored.rows[0].verified, false);
        assert.equal(
          (
            await identity.pool.query(
              'SELECT "twoFactorEnabled" FROM "user" WHERE email=$1',
              [credentials.email],
            )
          ).rows[0].twoFactorEnabled,
          false,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-totp",
              { code: "not-a-code" },
              activeCookie,
            )
          ).status,
          401,
        );
        await clearBudget();
        const verified = await post(
          "two-factor/verify-totp",
          { code: await otp.totp() },
          activeCookie,
        );
        assert.equal(verified.status, 200);
        activeCookie = cookieOf(verified) || activeCookie;
        assert.equal(
          (
            await identity.pool.query(
              'SELECT "twoFactorEnabled" FROM "user" WHERE email=$1',
              [credentials.email],
            )
          ).rows[0].twoFactorEnabled,
          true,
        );
      },
    );
    async function challenge() {
      await clearBudget();
      const result = await post("sign-in/email", credentials);
      assert.equal(result.status, 200);
      assert.equal((await result.json()).twoFactorRedirect, true);
      const cookie = cookieOf(result);
      assert.ok((await session(cookie)) === null);
      return cookie;
    }
    await t.test(
      "password first factor is not a usable session; TOTP binds challenge",
      async () => {
        assert.equal(
          (await post("sign-in/email", { ...credentials, trustDevice: true }))
            .status,
          400,
        );
        assert.equal(
          (
            await post(
              "sign-in/email",
              credentials,
              "totp-proof-candidate.trust_device=forged",
            )
          ).status,
          400,
        );
        const cookie = await challenge();
        assert.equal(
          (await post("two-factor/verify-totp", { code: await otp.totp() }))
            .status,
          401,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-totp",
              { code: await otp.totp(), trustDevice: true },
              cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-totp",
              { code: await otp.totp(), skipVerification: true },
              cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (await post("two-factor/send-otp", {}, cookie)).status,
          404,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-totp",
              { code: "invalid-code" },
              cookie,
            )
          ).status,
          401,
        );
        const expiredCode = await otp.hotp(Math.floor(Date.now() / 30000) - 3);
        assert.equal(
          (await post("two-factor/verify-totp", { code: expiredCode }, cookie))
            .status,
          401,
        );
        await clearBudget();
        const verified = await post(
          "two-factor/verify-totp",
          { code: await otp.totp() },
          cookie,
        );
        assert.equal(verified.status, 200);
        assert.ok(await session(cookieOf(verified)));
        assert.equal(
          (
            await post(
              "two-factor/verify-totp",
              { code: await otp.totp() },
              cookie,
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      "expired challenge denies even a current authenticator code",
      async () => {
        const cookie = await challenge();
        await identity.pool.query(
          `UPDATE verification SET "expiresAt"=NOW()-interval '1 minute' WHERE identifier LIKE '2fa-%'`,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-totp",
              { code: await otp.totp() },
              cookie,
            )
          ).status,
          401,
        );
        assert.ok((await session(cookie)) === null);
      },
    );
    await t.test(
      "recovery code is single-use including concurrent challenges",
      async () => {
        const first = await challenge(),
          second = await challenge();
        const results = await Promise.all(
          [first, second].map((cookie) =>
            post(
              "two-factor/verify-backup-code",
              { code: backupCodes[0] },
              cookie,
            ),
          ),
        );
        assert.equal(
          results.filter((result) => result.status === 200).length,
          1,
        );
        assert.equal(
          results.filter((result) => [401, 409].includes(result.status)).length,
          1,
        );
        const recovered = results.find((result) => result.status === 200);
        assert.ok(await session(cookieOf(recovered)));
        const next = await challenge();
        assert.equal(
          (
            await post(
              "two-factor/verify-backup-code",
              { code: backupCodes[0] },
              next,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-backup-code",
              { code: backupCodes[1], disableSession: true },
              next,
            )
          ).status,
          400,
        );
        const successful = await post(
          "two-factor/verify-backup-code",
          { code: backupCodes[1] },
          next,
        );
        assert.equal(successful.status, 200);
        assert.ok(await session(cookieOf(successful)));
      },
    );
    await t.test(
      "failed-code burst is rate limited without granting a session",
      async () => {
        const cookie = await challenge();
        const before = (
          await identity.pool.query(
            'SELECT secret,"backupCodes",verified FROM "twoFactor"',
          )
        ).rows[0];
        const statuses = [];
        // No test reset inside this burst: the maintained HTTP budget must act.
        for (let attempt = 0; attempt < 5; attempt++)
          statuses.push(
            (
              await post(
                "two-factor/verify-totp",
                { code: "invalid-code" },
                cookie,
              )
            ).status,
          );
        assert.ok(statuses.includes(401));
        assert.ok(statuses.includes(429));
        assert.ok(statuses.every((status) => status === 401 || status === 429));
        assert.ok((await session(cookie)) === null);
        const after = (
          await identity.pool.query(
            'SELECT secret,"backupCodes",verified FROM "twoFactor"',
          )
        ).rows[0];
        assert.ok(before.secret === after.secret);
        assert.ok(before.backupCodes === after.backupCodes);
        assert.equal(after.verified, true);
        await clearBudget(); // Separate method-contract checks from the completed abuse burst.
        for (const method of ["GET", "PUT"]) {
          const denied = await fetch(
            `${origin}/api/auth/two-factor/verify-totp`,
            {
              method,
              headers: { Cookie: cookie, Origin: origin },
              redirect: "manual",
              signal: AbortSignal.timeout(5000),
            },
          );
          assert.ok(
            [404, 405].includes(denied.status),
            `unexpected method status ${denied.status}`,
          );
        }
        assert.ok((await session(cookie)) === null);
        // Isolate the positive proof from HTTP request throttling; do not alter challenge/failure state.
        await clearBudget();
        const correct = await post(
          "two-factor/verify-totp",
          { code: await otp.totp() },
          cookie,
        );
        assert.equal(correct.status, 200);
        assert.ok(await session(cookieOf(correct)));
      },
    );
    await t.test(
      "recovery rotation and disabling require current password",
      async () => {
        await clearBudget();
        assert.equal(
          (
            await post(
              "two-factor/generate-backup-codes",
              { password: "wrong-current-password" },
              activeCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (await post("two-factor/get-totp-uri", {}, activeCookie)).status,
          400,
        );
        assert.equal(
          (
            await post(
              "two-factor/disable",
              { password: "wrong-current-password" },
              activeCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (await post("two-factor/enable", { password: credentials.password }))
            .status,
          401,
        );
        await clearBudget();
        const rotated = await post(
          "two-factor/generate-backup-codes",
          { password: credentials.password },
          activeCookie,
        );
        assert.equal(rotated.status, 200);
        const replacement = await rotated.json();
        assert.equal(replacement.backupCodes.length, 10);
        const cookie = await challenge();
        assert.equal(
          (
            await post(
              "two-factor/verify-backup-code",
              { code: backupCodes[2] },
              cookie,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await post(
              "two-factor/verify-backup-code",
              { code: replacement.backupCodes[0] },
              cookie,
            )
          ).status,
          200,
        );
        const disabled = await post(
          "two-factor/disable",
          { password: credentials.password },
          activeCookie,
        );
        assert.equal(disabled.status, 200);
        assert.equal(
          (
            await identity.pool.query(
              'SELECT "twoFactorEnabled" FROM "user" WHERE email=$1',
              [credentials.email],
            )
          ).rows[0].twoFactorEnabled,
          false,
        );
        await clearBudget();
        const plain = await post("sign-in/email", credentials);
        assert.equal(plain.status, 200);
        assert.ok(await session(cookieOf(plain)));
      },
    );
  },
);
