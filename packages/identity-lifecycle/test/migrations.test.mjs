import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  rm,
  cp,
  readFile,
  appendFile,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPasswordIdentity } from "../src/identity.mjs";
const execute = promisify(execFileCallback);
const execFile = (command, args) =>
  execute(command, args, { timeout: 15000, maxBuffer: 65536 });
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { pathToFileURL, fileURLToPath } from "node:url";
test(
  "immutable core/domain PG migrations retain data and refuse missing or changed history",
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "forma-migrations-"),
    );
    const name = `forma-migrations-${randomBytes(6).toString("hex")}`;
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
      `POSTGRES_USER=proof\nPOSTGRES_DB=migrations_proof\nPOSTGRES_PASSWORD=${password}\n`,
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
      databaseUrl: `postgres://proof:${password}@127.0.0.1:${port}/migrations_proof`,
      secret: randomBytes(32).toString("hex"),
      appId: "migration-proof",
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

    await identity.initialize({ migrate: false });
    await identity.pool.query(
      "ALTER TABLE forma_user_security RENAME TO held_security",
    );
    try {
      await assert.rejects(() => identity.initialize({ migrate: false }));
      assert.equal(
        (
          await identity.pool.query(
            "SELECT to_regclass('forma_user_security') AS name",
          )
        ).rows[0].name,
        null,
      );
    } finally {
      await identity.pool.query(
        "ALTER TABLE held_security RENAME TO forma_user_security",
      );
    }
    await identity.initialize({ migrate: false });
    const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
    const isolated = path.join(directory, "isolated-core");
    await cp(sourceRoot, isolated, { recursive: true });
    const history = await import(
      pathToFileURL(path.join(isolated, "migration-history.mjs"))
    );
    await history.inspectMigrationHistory(identity.pool, { required: true });
    const journal = async () =>
      JSON.stringify(
        (
          await identity.pool.query(
            "SELECT * FROM forma_identity_migrations ORDER BY name",
          )
        ).rows,
      );
    const before = await journal(),
      base = path.join(isolated, "migrations/001_assurance.sql"),
      bytes = await readFile(base);
    await appendFile(
      base,
      `
-- forbidden mutation
`,
    );
    await assert.rejects(
      () => history.inspectMigrationHistory(identity.pool, { required: true }),
      /checksum/,
    );
    assert.equal(await journal(), before);
    await writeFile(base, bytes);
    await unlink(base);
    await assert.rejects(
      () => history.inspectMigrationHistory(identity.pool, { required: true }),
      /missing/,
    );
    assert.equal(await journal(), before);
    await writeFile(base, bytes);
    const extension = path.join(isolated, "migrations/002_extension.sql");
    await writeFile(
      extension,
      "CREATE TABLE extension_probe(id INTEGER PRIMARY KEY,note TEXT NOT NULL);",
    );
    await assert.rejects(
      () => history.inspectMigrationHistory(identity.pool, { required: true }),
      /Pending/,
    );
    const inventory = await history.inspectMigrationHistory(identity.pool);
    await history.applySqlMigrations(identity.pool, inventory);
    await history.recordMigrationHistory(identity.pool, inventory);
    await identity.pool.query(
      "INSERT INTO extension_probe VALUES(1,'retained synthetic')",
    );
    await history.applySqlMigrations(identity.pool, inventory);
    assert.equal(
      (
        await identity.pool.query(
          "SELECT count(*)::int AS n FROM extension_probe",
        )
      ).rows[0].n,
      1,
    );
    await unlink(extension);
    await assert.rejects(
      () => history.inspectMigrationHistory(identity.pool, { required: true }),
      /missing/,
    );
    assert.equal(
      (
        await identity.pool.query(
          "SELECT count(*)::int AS n FROM extension_probe",
        )
      ).rows[0].n,
      1,
    );
    const policyRoot = fileURLToPath(
      new URL(
        "../../../blueprints/application/modules/records-auth/runtime/",
        import.meta.url,
      ),
    );
    const isolatedPolicy = path.join(directory, "isolated-policy");
    await cp(policyRoot, isolatedPolicy, { recursive: true });
    const policy = await import(
      pathToFileURL(path.join(isolatedPolicy, "policy.mjs"))
    );
    await policy.migratePolicy(identity.pool);
    await policy.verifyPolicy(identity.pool);
    const context = await identity.auth.$context;
    const user = await context.internalAdapter.createUser({
      name: "Synthetic migration user",
      email: "migration@example.test",
      emailVerified: true,
    });
    await assert.rejects(
      policy.approveMembership({
        userId: "unknown-user",
        organizationId: "migration-org",
        pool: identity.pool,
      }),
    );
    await assert.rejects(
      policy.approveMembership({
        userId: user.id,
        organizationId: "migration-org",
        pool: identity.pool,
        role: "owner",
      }),
    );
    await identity.pool.query(
      'UPDATE "user" SET "emailVerified"=FALSE WHERE id=$1',
      [user.id],
    );
    await assert.rejects(
      policy.approveMembership({
        userId: user.id,
        organizationId: "migration-org",
        pool: identity.pool,
      }),
    );
    await identity.pool.query(
      'UPDATE "user" SET "emailVerified"=TRUE WHERE id=$1',
      [user.id],
    );
    await policy.approveMembership({
      userId: user.id,
      organizationId: "migration-org",
      pool: identity.pool,
      role: "viewer",
    });
    assert.deepEqual(
      (
        await policy.permissionPolicy({
          userId: user.id,
          organizationId: "migration-org",
          pool: identity.pool,
        })
      ).permissions,
      ["records:read"],
    );
    await policy.approveMembership({
      userId: user.id,
      organizationId: "migration-org",
      pool: identity.pool,
      role: "member",
    });
    await policy.onVerifiedUser({
      userId: user.id,
      organizationId: "migration-org",
      pool: identity.pool,
    });
    assert.equal(
      (
        await policy.permissionPolicy({
          userId: user.id,
          organizationId: "migration-org",
          pool: identity.pool,
        })
      ).requiresMfa,
      false,
    );
    await identity.pool.query(
      'UPDATE "user" SET "emailVerified"=false WHERE id=$1',
      [user.id],
    );
    await assert.rejects(
      () =>
        policy.bootstrapAdministrator({
          userId: user.id,
          organizationId: "migration-org",
          pool: identity.pool,
        }),
      /verified/,
    );
    await identity.pool.query(
      'UPDATE "user" SET "emailVerified"=true WHERE id=$1',
      [user.id],
    );
    await policy.bootstrapAdministrator({
      userId: user.id,
      organizationId: "migration-org",
      pool: identity.pool,
    });
    assert.equal(
      (
        await policy.permissionPolicy({
          userId: user.id,
          organizationId: "migration-org",
          pool: identity.pool,
        })
      ).requiresMfa,
      true,
    );
    await assert.rejects(
      () =>
        policy.bootstrapAdministrator({
          userId: user.id,
          organizationId: "wrong-org",
          pool: identity.pool,
        }),
      /verified/,
    );
    const policySource = path.join(
      isolatedPolicy,
      "postgres/001_memberships.sql",
    );
    await appendFile(
      policySource,
      `
-- forbidden mutation
`,
    );
    await assert.rejects(() => policy.verifyPolicy(identity.pool), /changed/);
    await assert.rejects(() => policy.migratePolicy(identity.pool), /changed/);
    assert.equal(
      (
        await identity.pool.query(
          "SELECT count(*)::int AS n FROM identity_memberships",
        )
      ).rows[0].n,
      1,
    );
    await unlink(policySource);
    await assert.rejects(() => policy.verifyPolicy(identity.pool), /missing/);
  },
);
