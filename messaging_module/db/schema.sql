-- 10Blocuri Messaging Module Schema
-- Tables are prefixed with msg_ to avoid collisions with existing schema.

BEGIN;

CREATE TABLE IF NOT EXISTS msg_conversations (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('dm', 'board', 'announcement')),
  title VARCHAR(255),
  topic TEXT,
  scope VARCHAR(20) NOT NULL DEFAULT 'building' CHECK (scope IN ('building', 'neighborhood')),
  building_id VARCHAR(20),
  pinned_msg_id BIGINT,
  created_by VARCHAR(50) NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT msg_conversations_scope_building_check CHECK (
    (scope = 'neighborhood' AND building_id IS NULL)
    OR
    (scope = 'building' AND building_id IS NOT NULL)
  ),
  CONSTRAINT msg_conversations_building_id_format_check CHECK (
    building_id IS NULL OR building_id ~ '^bloc(10|[1-9])$'
  )
);

CREATE INDEX IF NOT EXISTS idx_msg_conversations_building_type_updated
  ON msg_conversations (building_id, type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_msg_conversations_scope_type_updated
  ON msg_conversations (scope, type, updated_at DESC);

CREATE TABLE IF NOT EXISTS msg_participants (
  conversation_id BIGINT NOT NULL REFERENCES msg_conversations(id) ON DELETE CASCADE,
  username VARCHAR(50) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'moderator')),
  last_read_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, username)
);

CREATE INDEX IF NOT EXISTS idx_msg_participants_username_last_read
  ON msg_participants (username, last_read_at);

CREATE TABLE IF NOT EXISTS msg_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES msg_conversations(id) ON DELETE CASCADE,
  sender VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  reply_to_id BIGINT REFERENCES msg_messages(id),
  attachment_key VARCHAR(500),
  attachment_name VARCHAR(255),
  attachment_type VARCHAR(100),
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_messages_conversation_created
  ON msg_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msg_messages_sender_created
  ON msg_messages (sender, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'msg_conversations_pinned_msg_fk'
  ) THEN
    ALTER TABLE msg_conversations
      ADD CONSTRAINT msg_conversations_pinned_msg_fk
      FOREIGN KEY (pinned_msg_id)
      REFERENCES msg_messages(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION msg_touch_conversation_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE msg_conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_msg_messages_touch_conversation ON msg_messages;

CREATE TRIGGER trg_msg_messages_touch_conversation
AFTER INSERT ON msg_messages
FOR EACH ROW
EXECUTE FUNCTION msg_touch_conversation_updated_at();

COMMIT;
