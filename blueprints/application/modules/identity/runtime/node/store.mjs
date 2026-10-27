import pg from "pg";
import { SECURITY_PROFILE } from "./profile.mjs";
export async function withIdentityStore(
  settings,
  { migrate = false },
  operation,
) {
  const pool = new pg.Pool({
    connectionString: settings.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2000,
    options: "-c search_path=public",
  });
  pool.on("error", () => {});
  let client;
  try {
    client = await pool.connect();
    await client.query("SET lock_timeout='5s'");
    await client.query("SELECT pg_advisory_lock(815251441)");
    await client.query("SET search_path=public");
    const markerInfo = (
      await client.query(
        "SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='forma_store_manifest'",
      )
    ).rows[0];
    if (markerInfo && markerInfo.relkind !== "r")
      throw new Error("Identity ownership marker must be an owned table");
    const marker = Boolean(markerInfo);
    if (!marker) {
      const tables = await client.query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'",
      );
      if (!migrate || tables.rowCount)
        throw new Error(
          "Explicit migration of a fresh unmarked identity store required; existing data is not adopted",
        );
      await client.query(
        `CREATE TABLE forma_store_manifest(singleton BOOLEAN PRIMARY KEY CHECK(singleton),app_id TEXT NOT NULL,organization_id TEXT NOT NULL,security_profile TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','ready')))`,
      );
      await client.query(
        "INSERT INTO forma_store_manifest VALUES(TRUE,$1,$2,$3,'pending')",
        [settings.appId, settings.organizationId, SECURITY_PROFILE],
      );
    }
    const owned = (
      await client.query(
        "SELECT * FROM forma_store_manifest WHERE singleton=TRUE",
      )
    ).rows[0];
    if (
      !owned ||
      owned.app_id !== settings.appId ||
      owned.organization_id !== settings.organizationId ||
      owned.security_profile !== SECURITY_PROFILE ||
      (!migrate && owned.state !== "ready")
    )
      throw new Error(
        "Identity store scope/security profile is incompatible or migration incomplete",
      );
    const result = await operation();
    if (migrate)
      await client.query(
        "UPDATE forma_store_manifest SET state='ready' WHERE singleton=TRUE",
      );
    return result;
  } finally {
    if (client) {
      try {
        await client.query("SELECT pg_advisory_unlock_all()");
        client.release();
      } catch {
        client.release(true);
      }
    }
    await pool.end();
  }
}
