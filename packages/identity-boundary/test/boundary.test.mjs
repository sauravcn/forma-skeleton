import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeSignature } from "better-auth/crypto";
import { createIdentity } from "../src/identity.mjs";
import { identityServer } from "../src/server.mjs";

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.PYTHON_BIN || "python3";
async function command(binary, args, options = {}) {
  return execute(binary, args, {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
}
async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server.address().port;
}
async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
function request(
  url,
  { method = "GET", cookie, origin, data, headers = {} } = {},
) {
  return fetch(url, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
}
async function startPython(env) {
  const child = spawn(python, [path.join(root, "python/protected_api.py")], {
    cwd: env.PROOF_WORKING_DIRECTORY,
    env: { ...process.env, ...env, PYTHONPATH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "",
    stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Python fixture failed: ${stderr}`);
    const match = stdout.match(/loopback port ([0-9]+)/);
    if (match) return { child, base: `http://127.0.0.1:${match[1]}` };
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  child.kill("SIGKILL");
  throw new Error("Python fixture startup timeout");
}
async function stopPython(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

test("missing or incomplete PostgreSQL target fails before pool or migrations", () => {
  const settings = {
    secret: "synthetic-only-secret-with-more-than-32-characters",
    appId: "proof-app",
    organizationId: "proof-org",
    publicOrigin: "http://127.0.0.1:3000",
  };
  for (const databaseUrl of [
    undefined,
    "",
    "postgresql://localhost/identity_proof",
    "postgresql://proof:synthetic@localhost:5432",
    "postgresql://proof:synthetic@localhost:0/identity_proof",
    "postgresql://proof:synthetic@remote.invalid:5432/identity_proof",
  ])
    assert.throws(() => createIdentity({ ...settings, databaseUrl }));
});

test("Python principal parser, proxy isolation and redirect denial use real loopback HTTP", async () => {
  await command(python, [
    "-m",
    "unittest",
    "discover",
    "-s",
    path.join(root, "test"),
    "-p",
    "client_test.py",
    "-v",
  ]);
});

test(
  "maintained PostgreSQL sessions authorize Python by current identity and scoped ownership",
  { timeout: 120000 },
  async (t) => {
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "forma-identity-boundary-"),
    );
    const container = `forma-identity-proof-${crypto.randomBytes(6).toString("hex")}`;
    const password = crypto.randomBytes(24).toString("hex");
    const secret = crypto.randomBytes(32).toString("hex");
    const environmentFile = path.join(temporary, "postgres.env");
    const children = [];
    let identity, service;
    t.after(async () => {
      for (const child of children) await stopPython(child);
      await close(service);
      if (identity) await identity.pool.end();
      await command("docker", ["rm", "-f", container]).catch(() => {});
      await fs.rm(temporary, { recursive: true, force: true });
    });
    await fs.writeFile(
      environmentFile,
      `POSTGRES_USER=proof\nPOSTGRES_DB=identity_proof\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 },
    );
    await command("docker", ["image", "inspect", "postgres:17-bookworm"]);
    await command("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--env-file",
      environmentFile,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,size=256m",
      "--publish",
      "127.0.0.1::5432",
      "--pull",
      "never",
      "postgres:17-bookworm",
    ]);
    const { stdout: mapped } = await command("docker", [
      "port",
      container,
      "5432/tcp",
    ]);
    const port = Number(mapped.trim().split(":").at(-1));
    assert.ok(port > 0);
    const appId = "proof-app",
      organizationId = "proof-org",
      publicOrigin = "http://127.0.0.1:3000";
    identity = createIdentity({
      databaseUrl: `postgresql://proof:${password}@127.0.0.1:${port}/identity_proof`,
      secret,
      appId,
      organizationId,
      publicOrigin,
    });
    let postgresReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await identity.pool.query("SELECT 1");
        postgresReady = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(
      postgresReady,
      true,
      "isolated synthetic PostgreSQL becomes ready",
    );
    await identity.initialize();
    const context = await identity.auth.$context;
    async function user(label, role = "member", organization = organizationId) {
      const actor = await context.internalAdapter.createUser({
        name: `Synthetic ${label}`,
        email: `${label}@example.invalid`,
        emailVerified: true,
      });
      await identity.pool.query(
        "INSERT INTO identity_memberships(user_id,organization_id,role) VALUES ($1,$2,$3)",
        [actor.id, organization, role],
      );
      const session = await context.internalAdapter.createSession(actor.id);
      const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token, secret)}`)}`;
      return { actor, session, cookie };
    }
    const alice = await user("alice"),
      bob = await user("bob"),
      outsider = await user("outsider", "member", "another-org"),
      expired = await user("expired"),
      revoked = await user("revoked");
    await context.internalAdapter.updateSession(expired.session.token, {
      expiresAt: new Date(Date.now() - 60000),
    });
    await context.internalAdapter.deleteSession(revoked.session.token);
    service = identityServer(identity);
    const identityPort = await listen(service);
    const database = path.join(temporary, "records.sqlite3");
    const environment = {
      PROOF_WORKING_DIRECTORY: temporary,
      PROOF_IDENTITY_URL: `http://127.0.0.1:${identityPort}/internal/identity`,
      PROOF_APP_ID: appId,
      PROOF_ORGANIZATION_ID: organizationId,
      PROOF_SESSION_COOKIE_NAME: context.authCookies.sessionToken.name,
      PROOF_PUBLIC_ORIGIN: publicOrigin,
      PROOF_DATABASE_PATH: database,
      PROOF_PORT: "0",
    };
    const api = await startPython(environment);
    children.push(api.child);
    const base = `${api.base}/api/records`;

    await t.test(
      "missing, forged, expired and revoked cookies deny actual Python reads and writes",
      async () => {
        for (const cookie of [
          undefined,
          "proof-app-proof.session_token=forged",
          expired.cookie,
          revoked.cookie,
        ]) {
          assert.equal((await request(base, { cookie })).status, 401);
          assert.equal(
            (
              await request(base, {
                method: "POST",
                cookie,
                origin: publicOrigin,
                data: { title: "Must not create" },
              })
            ).status,
            401,
          );
        }
        const response = await request(base, { cookie: alice.cookie });
        assert.deepEqual(await response.json(), { records: [] });
      },
    );
    await t.test(
      "principal is minimal and identifies only basic session assurance",
      async () => {
        const response = await request(environment.PROOF_IDENTITY_URL, {
          cookie: alice.cookie,
        });
        assert.equal(response.status, 200);
        const principal = await response.json();
        assert.deepEqual(
          Object.keys(principal).sort(),
          [
            "app_id",
            "organization_id",
            "user_id",
            "permissions",
            "expires_at",
            "assurance",
          ].sort(),
        );
        assert.equal(principal.user_id, alice.actor.id);
        assert.equal(principal.assurance, "basic-session-fixture");
        const health = await request(`${api.base}/api/health`);
        assert.equal((await health.json()).mfa_implemented, false);
      },
    );
    await t.test(
      "origin and forged owner/role fields do not grant authority",
      async () => {
        for (const origin of [undefined, "https://foreign.invalid"])
          assert.equal(
            (
              await request(base, {
                method: "POST",
                cookie: alice.cookie,
                origin,
                data: { title: "Must not create" },
              })
            ).status,
            403,
          );
        assert.equal(
          (
            await request(base, {
              method: "POST",
              cookie: alice.cookie,
              origin: publicOrigin,
              data: { title: "Invalid owner", owner_user_id: bob.actor.id },
            })
          ).status,
          400,
        );
        const created = await request(base, {
          method: "POST",
          cookie: alice.cookie,
          origin: publicOrigin,
          headers: {
            "X-User-ID": bob.actor.id,
            "X-Role": "admin",
            "X-Organization-ID": "another-org",
          },
          data: { title: "Synthetic Alice record" },
        });
        assert.equal(created.status, 201);
        const row = await created.json();
        assert.equal(row.owner_user_id, alice.actor.id);
        assert.equal(row.organization_id, organizationId);
        assert.deepEqual(
          await (
            await request(base, {
              cookie: bob.cookie,
              headers: { "X-User-ID": alice.actor.id, "X-Role": "admin" },
            })
          ).json(),
          { records: [] },
        );
        assert.equal(
          (
            await request(base, {
              cookie: outsider.cookie,
              headers: { "X-Organization-ID": organizationId },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "current database role/membership changes deny without a positive authorization cache",
      async () => {
        await identity.pool.query(
          "UPDATE identity_memberships SET role='viewer' WHERE user_id=$1",
          [alice.actor.id],
        );
        assert.equal(
          (
            await request(base, {
              method: "POST",
              cookie: alice.cookie,
              origin: publicOrigin,
              headers: { "X-Role": "admin" },
              data: { title: "Must not create" },
            })
          ).status,
          403,
        );
        assert.equal(
          (await request(base, { cookie: alice.cookie })).status,
          200,
        );
        await identity.pool.query(
          "UPDATE identity_memberships SET active=FALSE WHERE user_id=$1",
          [alice.actor.id],
        );
        assert.equal(
          (await request(base, { cookie: alice.cookie })).status,
          403,
        );
        await identity.pool.query(
          "UPDATE identity_memberships SET active=TRUE,role='member' WHERE user_id=$1",
          [alice.actor.id],
        );
      },
    );
    await t.test(
      "wrong configured child audience fails and direct login/test-login routes do not exist",
      async () => {
        const wrong = await startPython({
          ...environment,
          PROOF_APP_ID: "other-app",
        });
        children.push(wrong.child);
        assert.equal(
          (await request(`${wrong.base}/api/records`, { cookie: alice.cookie }))
            .status,
          403,
        );
        for (const path of [
          "/api/login",
          "/test-login",
          "/api/auth/sign-in/email",
        ])
          assert.equal(
            (
              await request(`http://127.0.0.1:${identityPort}${path}`, {
                method: "POST",
                data: {},
              })
            ).status,
            404,
          );
      },
    );
    await t.test(
      "completed revocation and unavailable identity service cannot authorize a write",
      async () => {
        await context.internalAdapter.deleteSession(bob.session.token);
        assert.equal((await request(base, { cookie: bob.cookie })).status, 401);
        const before = await (
          await request(base, { cookie: alice.cookie })
        ).json();
        await close(service);
        assert.equal(
          (
            await request(base, {
              method: "POST",
              cookie: alice.cookie,
              origin: publicOrigin,
              data: { title: "Must not create" },
            })
          ).status,
          503,
        );
        service = identityServer(identity);
        await listen(service, identityPort);
        assert.deepEqual(
          await (await request(base, { cookie: alice.cookie })).json(),
          before,
        );
      },
    );
  },
);
