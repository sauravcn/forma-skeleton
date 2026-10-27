import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = new URL("./migrations/", import.meta.url);
export async function inspectMigrationHistory(pool, { required = false } = {}) {
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9-]+\.(sql|json)$/.test(name))
    .sort();
  if (
    !names.includes("000_maintained-auth.json") ||
    !names.includes("001_assurance.sql")
  )
    throw new Error("Required identity migration source is missing");
  const inventory = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(new URL(name, directory)))
          .digest("hex"),
      ]),
    ),
  );
  const exists = (
    await pool.query("SELECT to_regclass('forma_identity_migrations') AS name")
  ).rows[0].name;
  if (!exists) {
    if (required) throw new Error("Explicit identity migration required");
    return inventory;
  }
  const rows = (
    await pool.query("SELECT name,checksum FROM forma_identity_migrations")
  ).rows;
  for (const row of rows)
    if (inventory.get(row.name) !== row.checksum)
      throw new Error(
        "Applied identity migration source missing or checksum changed",
      );
  if (required && rows.length !== inventory.size)
    throw new Error(
      "Pending identity migration requires explicit migration command",
    );
  return inventory;
}
export async function applySqlMigrations(pool, inventory) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TABLE IF NOT EXISTS forma_identity_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    for (const [name, checksum] of inventory) {
      if (!name.endsWith(".sql")) continue;
      const applied = await client.query(
        "SELECT 1 FROM forma_identity_migrations WHERE name=$1",
        [name],
      );
      if (applied.rowCount) continue;
      await client.query(await readFile(new URL(name, directory), "utf8"));
      await client.query(
        "INSERT INTO forma_identity_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function recordMigrationHistory(pool, inventory) {
  for (const [name, checksum] of inventory) {
    if (name.endsWith(".sql")) continue;
    await pool.query(
      "INSERT INTO forma_identity_migrations(name,checksum) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [name, checksum],
    );
  }
}
