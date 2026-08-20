ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_status VARCHAR(120) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_peer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sender_id <> receiver_id),
  CHECK (coalesce(length(body), 0) > 0 OR attachment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS direct_messages_pair_created_idx ON direct_messages(sender_id, receiver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS room_role_permissions (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('admin','member')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id, role)
);

INSERT INTO room_role_permissions(room_id,role,permissions)
SELECT id,'admin','{"manageChannels":true,"manageMembers":true,"createInvites":true,"sendMessages":true,"connectVoice":true}'::jsonb FROM rooms
ON CONFLICT DO NOTHING;
INSERT INTO room_role_permissions(room_id,role,permissions)
SELECT id,'member','{"manageChannels":false,"manageMembers":false,"createInvites":false,"sendMessages":true,"connectVoice":true}'::jsonb FROM rooms
ON CONFLICT DO NOTHING;
