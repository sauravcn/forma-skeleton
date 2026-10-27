import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMockOAuth } from "../src/mock-oauth.mjs";
import { createPasswordIdentity } from "../src/identity.mjs";
const execute = promisify(execFileCallback);
const execFile = (command, args) =>
  execute(command, args, { timeout: 15000, maxBuffer: 65536 });
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
test(
  "five explicit local MOCK OAuth providers use maintained callbacks then password and TOTP",
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
    let mock;
    server = http.createServer(async (req, res) => {
      if (mock && (await mock.handle(req, res))) return;
      return identity.handler(req, res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let clock = Date.now();
    mock = createMockOAuth({
      now: () => clock,
      publicOrigin: origin,
      authBasePath: "/mock-app/api/auth",
      env: {
        FORMA_MOCK_OAUTH: "1",
        FORMA_ENVIRONMENT: "local",
        NODE_ENV: "development",
      },
    });
    const messages = [];
    const deliveryFailures = [];
    let failMail = false;
    const approved = new Set();
    identity = createPasswordIdentity({
      databaseUrl: `postgres://proof:${password}@127.0.0.1:${port}/totp_proof`,
      secret: randomBytes(32).toString("hex"),
      appId: "mock-app",
      authBasePath: "/mock-app/api/auth",
      cookiePath: "/mock-app",
      mockOAuth: mock,
      enableTotp: true,
      requireMfa: true,
      organizationId: "synthetic-org",
      permissionPolicy: async ({ userId }) =>
        approved.has(userId)
          ? { permissions: ["records:read", "records:write"] }
          : null,
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
      return fetch(`${origin}/mock-app/api/auth/${route}`, {
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

    const jar = new Map();
    const cookie = () =>
      [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
    function collect(response) {
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = raw.split(";"),
          at = pair.indexOf("="),
          key = pair.slice(0, at),
          value = pair.slice(at + 1);
        if (raw.includes("Max-Age=0")) jar.delete(key);
        else jar.set(key, value);
      }
    }
    async function begin(provider) {
      const result = await post(
        "sign-in/social",
        {
          provider,
          callbackURL: `${origin}/mock-app/auth`,
          errorCallbackURL: `${origin}/mock-app/auth`,
          disableRedirect: true,
        },
        cookie(),
      );
      assert.equal(result.status, 200);
      collect(result);
      const data = await result.json();
      assert.equal(
        new URL(data.url).pathname,
        `/mock-app/__mock-oauth/${provider}/authorize`,
      );
      return data.url;
    }
    async function consent(url, decision = "approve", profile = "primary") {
      const page = await fetch(url, {
        headers: { Cookie: cookie() },
        redirect: "manual",
      });
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("referrer-policy"), "same-origin");
      const html = await page.text();
      assert.ok(html.includes("MOCK sign-in"));
      const requestId = html.match(/name="request_id" value="([^"]+)"/)[1];
      const result = await fetch(url.split("?")[0], {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ request_id: requestId, decision, profile }),
        redirect: "manual",
      });
      assert.equal(result.status, 303);
      return result.headers.get("location");
    }
    async function callback(url, raw = cookie()) {
      const result = await fetch(url, {
        headers: { Cookie: raw },
        redirect: "manual",
      });
      collect(result);
      return result;
    }
    for (const provider of [
      "google",
      "facebook",
      "github",
      "microsoft",
      "apple",
    ]) {
      jar.clear();
      const started = await begin(provider),
        location = await consent(started),
        stateCookie = cookie();
      const tampered = new URL(location);
      tampered.searchParams.set("state", "invalid-state");
      const bad = await callback(tampered.href, stateCookie);
      assert.ok(
        !bad.headers
          .getSetCookie()
          .some(
            (value) =>
              value.includes("session_token=") && !value.includes("Max-Age=0"),
          ),
      );
      const completed = await callback(location, stateCookie);
      assert.ok(completed.status < 400);
      assert.ok(
        completed.headers
          .getSetCookie()
          .some(
            (value) =>
              value.includes("session_token=") && !value.includes("Max-Age=0"),
          ),
      );
      const descriptor = await fetch(
        `${origin}/mock-app/api/auth/forma-state`,
        { headers: { Cookie: cookie() } },
      );
      const state = await descriptor.json();
      assert.equal(state.stage, "enroll");
      assert.equal(state.passwordRequired, true);
      assert.equal(state.providers.length, 5);
      const setup = await post(
        "forma-set-password",
        { newPassword: "Synthetic-provider-password-793" },
        cookie(),
      );
      assert.equal(setup.status, 200);
      assert.equal(
        (
          await (
            await fetch(`${origin}/mock-app/api/auth/forma-state`, {
              headers: { Cookie: cookie() },
            })
          ).json()
        ).passwordRequired,
        false,
      );
      const enrolled = await post(
        "two-factor/enable",
        { password: "Synthetic-provider-password-793" },
        cookie(),
      );
      assert.equal(enrolled.status, 200);
      const enrollment = await enrolled.json();
      const secret = new TextDecoder().decode(
        base32.decode(new URL(enrollment.totpURI).searchParams.get("secret")),
      );
      const confirmed = await post(
        "two-factor/verify-totp",
        { code: await createOTP(secret).totp() },
        cookie(),
      );
      assert.equal(confirmed.status, 200);
      collect(confirmed);
      assert.equal(
        (await identity.introspect(cookie())).status,
        403,
        "MFA never grants organization membership",
      );
      const userId = (
        await identity.pool.query('SELECT id FROM "user" WHERE email=$1', [
          `${provider}.primary@synthetic.test`,
        ])
      ).rows[0].id;
      approved.add(userId);
      assert.equal((await identity.introspect(cookie())).status, 200);
      const returnLocation = await consent(await begin(provider));
      const returning = await callback(returnLocation);
      assert.ok(returning.status < 400);
      const returnedState = await (
        await fetch(`${origin}/mock-app/api/auth/forma-state`, {
          headers: { Cookie: cookie() },
        })
      ).json();
      assert.equal(returnedState.stage, "challenge");
      assert.equal(
        (await identity.introspect(cookie())).status,
        403,
        "OAuth return remains basic until factor",
      );
      const recovered = await post(
        "two-factor/verify-backup-code",
        { code: enrollment.backupCodes[0] },
        cookie(),
      );
      assert.equal(recovered.status, 200);
      collect(recovered);
      assert.equal((await identity.introspect(cookie())).status, 200);
      const replay = await callback(location, stateCookie);
      assert.ok(
        !replay.headers
          .getSetCookie()
          .some(
            (value) =>
              value.includes("session_token=") && !value.includes("Max-Age=0"),
          ),
      );
      await identity.pool.query('DELETE FROM "rateLimit"');
    }
    jar.clear();
    const canceled = await callback(
      await consent(await begin("google"), "cancel"),
    );
    assert.equal(
      new URL(canceled.headers.get("location")).pathname,
      "/mock-app/auth",
    );
    assert.equal(
      new URL(canceled.headers.get("location")).searchParams.get("error"),
      "access_denied",
    );
    assert.ok(
      !canceled.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("session_token=") && !value.includes("Max-Age=0"),
        ),
    );
    jar.clear();
    const collision = {
      email: "collision@synthetic.test",
      username: "collision_user",
      name: "Synthetic Existing",
      password: "Synthetic-existing-password-981",
    };
    assert.equal((await post("sign-up/email", collision)).status, 200);
    await fetch(
      messages.findLast((message) => message.kind === "verification").url,
      { redirect: "manual" },
    );
    const collisionCallback = await callback(
      await consent(await begin("google"), "approve", "collision"),
    );
    assert.ok(
      new URL(collisionCallback.headers.get("location")).searchParams.has(
        "error",
      ),
    );
    assert.ok(
      !collisionCallback.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("session_token=") && !value.includes("Max-Age=0"),
        ),
    );
    assert.equal(
      (
        await identity.pool.query(
          'SELECT count(*)::int AS n FROM "user" WHERE email=$1',
          [collision.email],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await identity.pool.query(
          'SELECT count(*)::int AS n FROM account a JOIN "user" u ON a."userId"=u.id WHERE u.email=$1 AND a."providerId"=$2',
          [collision.email, "google"],
        )
      ).rows[0].n,
      0,
    );
    const verifier = "x".repeat(64),
      protocolURL = new URL(`${origin}/mock-app/__mock-oauth/google/authorize`);
    protocolURL.search = new URLSearchParams({
      client_id: "forma-local-mock-google",
      redirect_uri: `${origin}/mock-app/api/auth/callback/google`,
      response_type: "code",
      state: "provider-protocol-fixture",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    const foreignRedirect = new URL(protocolURL);
    foreignRedirect.searchParams.set(
      "redirect_uri",
      "https://external.invalid/callback",
    );
    assert.equal(
      (await fetch(foreignRedirect, { redirect: "manual" })).status,
      400,
    );
    const deniedPage = await fetch(protocolURL);
    const deniedHTML = await deniedPage.text();
    const deniedId = deniedHTML.match(/name="request_id" value="([^"]+)"/)[1];
    for (const originHeader of [undefined, "null", "http://foreign.invalid"]) {
      const denied = await fetch(protocolURL.href.split("?")[0], {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(originHeader ? { Origin: originHeader } : {}),
        },
        body: new URLSearchParams({
          request_id: deniedId,
          decision: "approve",
          profile: "primary",
        }),
        redirect: "manual",
      });
      assert.equal(denied.status, 400);
      assert.equal(denied.headers.get("location"), null);
      assert.equal(denied.headers.getSetCookie().length, 0);
    }
    const protocolCallback = await consent(protocolURL.href),
      protocolCode = new URL(protocolCallback).searchParams.get("code");
    await assert.rejects(
      mock.configs[0].getToken({
        code: protocolCode,
        codeVerifier: "y".repeat(64),
        redirectURI: `${origin}/mock-app/api/auth/callback/google`,
      }),
    );
    await assert.rejects(
      mock.configs[0].getToken({
        code: protocolCode,
        codeVerifier: verifier,
        redirectURI: `${origin}/mock-app/api/auth/callback/google`,
      }),
    );
    const expiredCallback = await consent(protocolURL.href);
    clock += 61000;
    await assert.rejects(
      mock.configs[0].getToken({
        code: new URL(expiredCallback).searchParams.get("code"),
        codeVerifier: verifier,
        redirectURI: `${origin}/mock-app/api/auth/callback/google`,
      }),
    );
    for (const patch of [
      { FORMA_ENVIRONMENT: undefined },
      { NODE_ENV: "production" },
      { FORMA_MOCK_OAUTH: "true" },
    ])
      assert.throws(() =>
        createMockOAuth({
          publicOrigin: origin,
          env: { FORMA_MOCK_OAUTH: "1", FORMA_ENVIRONMENT: "local", ...patch },
        }),
      );
    assert.throws(() =>
      createMockOAuth({
        publicOrigin: "https://external.invalid",
        env: { FORMA_MOCK_OAUTH: "1", FORMA_ENVIRONMENT: "local" },
      }),
    );
    assert.throws(() =>
      createMockOAuth({
        publicOrigin: origin,
        env: {
          FORMA_MOCK_OAUTH: "1",
          FORMA_ENVIRONMENT: "local",
          NODE_ENV: "production",
        },
      }),
    );
  },
);
