UPDATE users
SET site_role = 'superadmin', email = 'azazjogos@gmail.com'
WHERE lower(username) = 'arcanjoraziel';

CREATE TABLE IF NOT EXISTS channel_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, name)
);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES channel_categories(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS server_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#8f95a3',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, name)
);

CREATE TABLE IF NOT EXISTS server_role_members (
  role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, user_id)
);

CREATE TABLE IF NOT EXISTS category_role_permissions (
  category_id UUID NOT NULL REFERENCES channel_categories(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(category_id, role_id)
);

INSERT INTO channel_categories(room_id, name, position)
SELECT id, 'Geral', 0 FROM rooms ON CONFLICT DO NOTHING;

UPDATE channels c SET category_id = cc.id
FROM channel_categories cc
WHERE cc.room_id = c.room_id AND cc.name = 'Geral' AND c.category_id IS NULL;
