CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(32) UNIQUE NOT NULL CHECK (username ~ '^[a-zA-Z0-9_]{3,32}$'),
  display_name VARCHAR(50) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) NOT NULL,
  slug VARCHAR(60) UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('text','voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, name, kind)
);
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages(channel_id, created_at DESC);
CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  code VARCHAR(32) UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  max_uses INT,
  uses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
