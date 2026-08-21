CREATE TABLE IF NOT EXISTS channel_role_access (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
  PRIMARY KEY(channel_id, role_id)
);

CREATE INDEX IF NOT EXISTS channel_role_access_role_idx ON channel_role_access(role_id);
