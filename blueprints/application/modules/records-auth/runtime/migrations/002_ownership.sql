ALTER TABLE records ADD COLUMN organization_id TEXT NOT NULL;
ALTER TABLE records ADD COLUMN owner_user_id TEXT NOT NULL;
CREATE INDEX records_owner_scope ON records(organization_id,owner_user_id,id);
