/** Real isolated PostgreSQL counterexamples for the generated-store boundary.
 * These component tests supplement, never replace, the installed browser gate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withIdentityStore } from "../../blueprints/application/modules/identity/runtime/node/store.mjs";
import { disposablePostgres } from "./fixtures/disposable-postgres.mjs";
async function fixture(t) {
  const database = await disposablePostgres();
  const pool = new pg.Pool({ connectionString: database.databaseUrl });
  t.after(async () => {
    await pool.end();
    await database.close();
  });
  return {
    pool,
    settings: {
      databaseUrl: database.databaseUrl,
      appId: "store-proof",
      organizationId: "synthetic-org",
    },
  };
}
test(
  "uninitialized runtime and foreign view are refused without adoption",
  { timeout: 60000 },
  async (t) => {
    const { pool, settings } = await fixture(t);
    await assert.rejects(
      withIdentityStore(settings, { migrate: false }, async () => {}),
    );
    assert.equal(
      (await pool.query("SELECT to_regclass('forma_store_manifest') AS name"))
        .rows[0].name,
      null,
    );
    await pool.query("CREATE VIEW unrelated_view AS SELECT 17 AS preserved");
    await assert.rejects(
      withIdentityStore(settings, { migrate: true }, async () => {}),
    );
    assert.equal(
      (await pool.query("SELECT preserved FROM unrelated_view")).rows[0]
        .preserved,
      17,
    );
    assert.equal(
      (await pool.query("SELECT to_regclass('forma_store_manifest') AS name"))
        .rows[0].name,
      null,
    );
  },
);
test(
  "interrupted migration stays unavailable and scope changes refuse data",
  { timeout: 60000 },
  async (t) => {
    const { pool, settings } = await fixture(t);
    await assert.rejects(
      withIdentityStore(settings, { migrate: true }, async () => {
        throw new Error("synthetic interruption");
      }),
    );
    await assert.rejects(
      withIdentityStore(settings, { migrate: false }, async () => {}),
    );
    await withIdentityStore(settings, { migrate: true }, async () => {
      await pool.query("CREATE TABLE preserved_record(value INTEGER)");
      await pool.query("INSERT INTO preserved_record VALUES(29)");
    });
    await withIdentityStore(settings, { migrate: false }, async () => {});
    for (const changes of [
      { appId: "another-app" },
      { organizationId: "another-org" },
    ])
      await assert.rejects(
        withIdentityStore(
          { ...settings, ...changes },
          { migrate: true },
          async () => {},
        ),
      );
    assert.equal(
      (await pool.query("SELECT value FROM preserved_record")).rows[0].value,
      29,
    );
  },
);
