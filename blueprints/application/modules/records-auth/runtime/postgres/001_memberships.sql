CREATE TABLE IF NOT EXISTS identity_memberships (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('viewer','member','admin')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY(user_id,organization_id)
);
