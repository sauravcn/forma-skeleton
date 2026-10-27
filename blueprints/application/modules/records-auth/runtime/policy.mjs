/** App-owned role/permission vocabulary and immutable PostgreSQL policy migration. */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const permissions = {
  viewer: ["records:read"],
  member: ["records:read", "records:write"],
  admin: [
    "records:read",
    "records:write",
    "records:read:any",
    "records:write:any",
  ],
};
async function inventory() {
  const directory = new URL("./postgres/", import.meta.url),
    names = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9-]+\.sql$/.test(name))
      .sort();
  if (!names.includes("001_memberships.sql"))
    throw new Error("Required domain permission migration source missing");
  return Promise.all(
    names.map(async (name) => {
      const source = await readFile(new URL(name, directory), "utf8");
      return {
        name,
        source,
        checksum: createHash("sha256").update(source).digest("hex"),
      };
    }),
  );
}
export async function verifyPolicy(pool, { required = true } = {}) {
  const files = await inventory(),
    exists = (
      await pool.query(
        "SELECT to_regclass('forma_records_policy_migrations') AS name",
      )
    ).rows[0].name;
  if (!exists) {
    if (required)
      throw new Error("Explicit permission policy migration required");
    return files;
  }
  const rows = (
    await pool.query(
      "SELECT name,checksum FROM forma_records_policy_migrations",
    )
  ).rows;
  for (const row of rows)
    if (
      !files.some(
        (file) => file.name === row.name && file.checksum === row.checksum,
      )
    )
      throw new Error("Applied domain permission migration missing or changed");
  if (rows.some((row) => row.name === "001_memberships.sql"))
    await pool.query(
      "SELECT user_id,organization_id,role,active FROM identity_memberships LIMIT 0",
    );
  if (required && rows.length !== files.length)
    throw new Error(
      "Pending domain permission migration requires explicit setup",
    );
  return files;
}
export async function migratePolicy(pool) {
  const files = await verifyPolicy(pool, { required: false }),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TABLE IF NOT EXISTS forma_records_policy_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    for (const file of files) {
      if (
        (
          await client.query(
            "SELECT 1 FROM forma_records_policy_migrations WHERE name=$1",
            [file.name],
          )
        ).rowCount
      )
        continue;
      await client.query(file.source);
      await client.query(
        "INSERT INTO forma_records_policy_migrations(name,checksum) VALUES($1,$2)",
        [file.name, file.checksum],
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
export async function permissionPolicy({ userId, organizationId, pool }) {
  const row = (
    await pool.query(
      "SELECT role FROM identity_memberships WHERE user_id=$1 AND organization_id=$2 AND active=TRUE",
      [userId, organizationId],
    )
  ).rows[0];
  return row && permissions[row.role]
    ? {
        permissions: [...permissions[row.role]],
        requiresMfa: row.role === "admin",
      }
    : null;
}
export async function onVerifiedUser({ userId, organizationId, pool }) {
  await pool.query(
    "INSERT INTO identity_memberships(user_id,organization_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",
    [userId, organizationId],
  );
}

/** Explicit operator admission; OAuth verification alone never inserts a membership. */
export async function approveMembership({
  userId,
  organizationId,
  pool,
  role = "member",
}) {
  if (
    typeof userId !== "string" ||
    !userId ||
    userId.length > 200 ||
    typeof organizationId !== "string" ||
    !organizationId ||
    !Object.hasOwn(permissions, role)
  )
    throw Error(
      "Explicit verified account, organization and supported role required",
    );
  const result = await pool.query(
    `INSERT INTO identity_memberships(user_id,organization_id,role) SELECT id,$2,$3 FROM "user" WHERE id=$1 AND "emailVerified"=TRUE ON CONFLICT(user_id,organization_id) DO UPDATE SET role=EXCLUDED.role,active=TRUE`,
    [userId, organizationId, role],
  );
  if (result.rowCount !== 1)
    throw Error("Approval requires an existing verified child account");
}

/** Operator-only source API; never a first-signup or browser promotion. */
export async function bootstrapAdministrator({ userId, organizationId, pool }) {
  if (typeof userId !== "string" || !userId || userId.length > 200)
    throw new Error("Explicit existing user ID required");
  const result = await pool.query(
    `UPDATE identity_memberships m SET role='admin' FROM "user" u WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active=TRUE AND u.id=m.user_id AND u."emailVerified"=TRUE`,
    [userId, organizationId],
  );
  if (result.rowCount !== 1)
    throw new Error("Bootstrap requires an existing verified child member");
}
