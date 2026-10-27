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
export async function migrateRecordsPolicy(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS identity_memberships(user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,organization_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('viewer','member','admin')),active BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(user_id,organization_id))`,
  );
}
export async function recordsPermissionPolicy({
  userId,
  organizationId,
  pool,
}) {
  const row = (
    await pool.query(
      "SELECT role FROM identity_memberships WHERE user_id=$1 AND organization_id=$2 AND active=TRUE",
      [userId, organizationId],
    )
  ).rows[0];
  return row && permissions[row.role]
    ? { permissions: permissions[row.role], requiresMfa: row.role === "admin" }
    : null;
}
