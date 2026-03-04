import { query, withTransaction } from "../../lib/db.js";

const ALLOWED_TYPES = new Set(["dm", "board", "announcement"]);

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeType(type) {
  const value = String(type || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_TYPES.has(value)) return null;
  return value;
}

function normalizeScope(scope) {
  const value = String(scope || "")
    .trim()
    .toLowerCase();
  return value === "neighborhood" ? "neighborhood" : "building";
}

function normalizeBuildingId(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (/^bloc(10|[1-9])$/.test(raw)) return raw;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 10) {
    return `bloc${numeric}`;
  }
  return null;
}

function normalizeLimit(limit, fallback, max) {
  const numeric = Number(limit);
  if (!Number.isInteger(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
}

function normalizeCursor(cursor) {
  if (!cursor) return null;
  const parsed = new Date(cursor);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

function normalizeUsernames(usernames) {
  if (!Array.isArray(usernames)) return [];
  const unique = new Set();
  for (const username of usernames) {
    const normalized = normalizeUsername(username);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique];
}

function mapConversationRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    type: String(row.type),
    title: row.title == null ? null : String(row.title),
    topic: row.topic == null ? null : String(row.topic),
    scope: String(row.scope),
    building_id: row.building_id == null ? null : String(row.building_id),
    pinned_msg_id: row.pinned_msg_id == null ? null : Number(row.pinned_msg_id),
    created_by: String(row.created_by),
    is_locked: Boolean(row.is_locked),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    last_message: row.last_message_id
      ? {
          id: Number(row.last_message_id),
          sender: String(row.last_message_sender || ""),
          content: String(row.last_message_preview || ""),
          created_at: toIso(row.last_message_created_at),
        }
      : null,
    unread_count: Number(row.unread_count || 0),
    participant_count: Number(row.participant_count || 0),
  };
}

function mapParticipantRow(row) {
  return {
    username: String(row.username),
    role: String(row.role),
    last_read_at: toIso(row.last_read_at),
    muted_until: toIso(row.muted_until),
    joined_at: toIso(row.joined_at),
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender: String(row.sender),
    content: String(row.content || ""),
    reply_to_id: row.reply_to_id == null ? null : Number(row.reply_to_id),
    reply_to: row.reply_to_id
      ? {
          id: Number(row.reply_to_id),
          sender: row.reply_to_sender == null ? null : String(row.reply_to_sender),
          content: row.reply_to_content == null ? null : String(row.reply_to_content),
        }
      : null,
    attachment_key: row.attachment_key == null ? null : String(row.attachment_key),
    attachment_name: row.attachment_name == null ? null : String(row.attachment_name),
    attachment_type: row.attachment_type == null ? null : String(row.attachment_type),
    is_pinned: Boolean(row.is_pinned),
    edited_at: toIso(row.edited_at),
    deleted_at: toIso(row.deleted_at),
    deleted_by: row.deleted_by == null ? null : String(row.deleted_by),
    created_at: toIso(row.created_at),
  };
}

export async function getConversationsForUser(username, building_id, type_filter, cursor, limit) {
  const safeUsername = normalizeUsername(username);
  const safeBuildingId = normalizeBuildingId(building_id);
  const safeType = normalizeType(type_filter);
  const safeCursor = normalizeCursor(cursor);
  const safeLimit = normalizeLimit(limit, 20, 100);

  const result = await query(
    `
      WITH visible AS (
        SELECT c.*
        FROM msg_conversations c
        WHERE
          ($1::text = 'admin')
          OR EXISTS (
            SELECT 1
            FROM msg_participants p
            WHERE p.conversation_id = c.id
              AND p.username = $1::text
          )
          OR c.scope = 'neighborhood'
          OR ($2::text IS NOT NULL AND c.scope = 'building' AND c.building_id = $2::text)
      )
      SELECT
        c.*,
        lm.id AS last_message_id,
        lm.sender AS last_message_sender,
        lm.preview AS last_message_preview,
        lm.created_at AS last_message_created_at,
        COALESCE(pc.participant_count, 0)::int AS participant_count,
        COALESCE(uc.unread_count, 0)::int AS unread_count
      FROM visible c
      LEFT JOIN LATERAL (
        SELECT
          m.id,
          m.sender,
          CASE
            WHEN m.deleted_at IS NOT NULL THEN 'Mesaj șters'
            ELSE LEFT(COALESCE(m.content, ''), 220)
          END AS preview,
          m.created_at::timestamptz AS created_at
        FROM msg_messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at::timestamptz DESC, m.id DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS participant_count
        FROM msg_participants p
        WHERE p.conversation_id = c.id
      ) pc ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread_count
        FROM msg_messages m
        LEFT JOIN msg_participants p
          ON p.conversation_id = c.id
         AND p.username = $1::text
        WHERE m.conversation_id = c.id
          AND m.deleted_at IS NULL
          AND m.sender <> $1::text
          AND m.created_at::timestamptz > COALESCE(p.last_read_at, to_timestamp(0))
      ) uc ON TRUE
      WHERE ($3::text IS NULL OR c.type = $3::text)
        AND ($4::timestamptz IS NULL OR c.updated_at::timestamptz < $4::timestamptz)
      ORDER BY c.updated_at::timestamptz DESC, c.id DESC
      LIMIT $5::int
    `,
    [safeUsername, safeBuildingId, safeType, safeCursor, safeLimit]
  );

  return result.rows.map(mapConversationRow);
}

export async function getConversationById(id) {
  const conversationId = Number(id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;

  const result = await query(
    `
      SELECT
        c.*,
        pm.id AS pinned_message_id,
        pm.sender AS pinned_message_sender,
        CASE
          WHEN pm.deleted_at IS NOT NULL THEN 'Mesaj șters'
          ELSE pm.content
        END AS pinned_message_content,
        pm.created_at AS pinned_message_created_at
      FROM msg_conversations c
      LEFT JOIN msg_messages pm
        ON pm.id = c.pinned_msg_id
      WHERE c.id = $1::bigint
      LIMIT 1
    `,
    [conversationId]
  );

  if (!result.rowCount) return null;

  const participantsResult = await query(
    `
      SELECT conversation_id, username, role, last_read_at, muted_until, joined_at
      FROM msg_participants
      WHERE conversation_id = $1::bigint
      ORDER BY
        CASE role
          WHEN 'admin' THEN 0
          WHEN 'moderator' THEN 1
          ELSE 2
        END,
        username ASC
    `,
    [conversationId]
  );

  const row = result.rows[0];
  const conversation = mapConversationRow(row);
  return {
    ...conversation,
    pinned_message: row.pinned_message_id
      ? {
          id: Number(row.pinned_message_id),
          sender: row.pinned_message_sender == null ? null : String(row.pinned_message_sender),
          content: row.pinned_message_content == null ? null : String(row.pinned_message_content),
          created_at: toIso(row.pinned_message_created_at),
        }
      : null,
    participants: participantsResult.rows.map(mapParticipantRow),
  };
}

export async function createConversation(type, title, topic, scope, building_id, created_by) {
  const safeType = normalizeType(type);
  const safeScope = normalizeScope(scope);
  const safeBuildingId = safeScope === "neighborhood" ? null : normalizeBuildingId(building_id);
  const safeCreator = normalizeUsername(created_by);

  const result = await query(
    `
      INSERT INTO msg_conversations (
        type,
        title,
        topic,
        scope,
        building_id,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, NOW(), NOW())
      RETURNING *
    `,
    [safeType, title == null ? null : String(title), topic == null ? null : String(topic), safeScope, safeBuildingId, safeCreator]
  );

  return mapConversationRow(result.rows[0]);
}

export async function addParticipants(conversation_id, usernames, role = "member") {
  const conversationId = Number(conversation_id);
  const safeRole = ["member", "admin", "moderator"].includes(String(role || ""))
    ? String(role)
    : "member";
  const normalized = normalizeUsernames(usernames);
  if (!Number.isInteger(conversationId) || conversationId <= 0 || !normalized.length) {
    return [];
  }

  const result = await query(
    `
      INSERT INTO msg_participants (conversation_id, username, role)
      SELECT $1::bigint, username, $3::text
      FROM UNNEST($2::text[]) AS t(username)
      ON CONFLICT (conversation_id, username)
      DO UPDATE SET role = EXCLUDED.role
      RETURNING username, role, last_read_at, muted_until, joined_at
    `,
    [conversationId, normalized, safeRole]
  );

  return result.rows.map(mapParticipantRow);
}

export async function removeParticipants(conversation_id, usernames) {
  const conversationId = Number(conversation_id);
  const normalized = normalizeUsernames(usernames);
  if (!Number.isInteger(conversationId) || conversationId <= 0 || !normalized.length) {
    return [];
  }

  const result = await query(
    `
      DELETE FROM msg_participants
      WHERE conversation_id = $1::bigint
        AND username = ANY($2::text[])
      RETURNING username
    `,
    [conversationId, normalized]
  );

  return result.rows.map((row) => String(row.username));
}

export async function findExistingDM(username1, username2) {
  const u1 = normalizeUsername(username1);
  const u2 = normalizeUsername(username2);
  if (!u1 || !u2) return null;

  const result = await query(
    `
      SELECT c.*
      FROM msg_conversations c
      WHERE c.type = 'dm'
        AND EXISTS (
          SELECT 1
          FROM msg_participants p
          WHERE p.conversation_id = c.id
            AND p.username = $1::text
        )
        AND EXISTS (
          SELECT 1
          FROM msg_participants p
          WHERE p.conversation_id = c.id
            AND p.username = $2::text
        )
        AND NOT EXISTS (
          SELECT 1
          FROM msg_participants p
          WHERE p.conversation_id = c.id
            AND p.username NOT IN ($1::text, $2::text, 'admin')
      )
      ORDER BY c.updated_at::timestamptz DESC, c.id DESC
      LIMIT 1
    `,
    [u1, u2]
  );

  if (!result.rowCount) return null;
  return mapConversationRow(result.rows[0]);
}

export async function getMessages(conversation_id, before_cursor, limit) {
  const conversationId = Number(conversation_id);
  const safeCursor = normalizeCursor(before_cursor);
  const safeLimit = normalizeLimit(limit, 50, 100);

  const result = await query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.sender,
        CASE
          WHEN m.deleted_at IS NOT NULL THEN 'Mesaj șters'
          ELSE m.content
        END AS content,
        m.reply_to_id,
        CASE
          WHEN r.deleted_at IS NOT NULL THEN 'Mesaj șters'
          ELSE r.content
        END AS reply_to_content,
        r.sender AS reply_to_sender,
        m.attachment_key,
        m.attachment_name,
        m.attachment_type,
        m.is_pinned,
        m.edited_at,
        m.deleted_at,
        m.deleted_by,
        m.created_at
      FROM msg_messages m
      LEFT JOIN msg_messages r
        ON r.id = m.reply_to_id
      WHERE m.conversation_id = $1::bigint
        AND ($2::timestamptz IS NULL OR m.created_at::timestamptz < $2::timestamptz)
      ORDER BY m.created_at::timestamptz DESC, m.id DESC
      LIMIT $3::int
    `,
    [conversationId, safeCursor, safeLimit]
  );

  return result.rows.map(mapMessageRow);
}

export async function createMessage(
  conversation_id,
  sender,
  content,
  reply_to_id = null,
  attachment_key = null,
  attachment_name = null,
  attachment_type = null
) {
  const conversationId = Number(conversation_id);
  const safeSender = normalizeUsername(sender);
  const safeReplyTo = reply_to_id == null ? null : Number(reply_to_id);

  const inserted = await withTransaction(async (client) => {
    const messageResult = await client.query(
      `
        INSERT INTO msg_messages (
          conversation_id,
          sender,
          content,
          reply_to_id,
          attachment_key,
          attachment_name,
          attachment_type,
          created_at
        )
        VALUES ($1::bigint, $2::text, $3::text, $4::bigint, $5::text, $6::text, $7::text, NOW())
        RETURNING *
      `,
      [
        conversationId,
        safeSender,
        String(content || ""),
        Number.isInteger(safeReplyTo) && safeReplyTo > 0 ? safeReplyTo : null,
        attachment_key == null ? null : String(attachment_key),
        attachment_name == null ? null : String(attachment_name),
        attachment_type == null ? null : String(attachment_type),
      ]
    );

    await client.query(
      `
        UPDATE msg_conversations
        SET updated_at = NOW()
        WHERE id = $1::bigint
      `,
      [conversationId]
    );

    return messageResult.rows[0];
  });

  return mapMessageRow(inserted);
}

export async function markAsRead(conversation_id, username) {
  const conversationId = Number(conversation_id);
  const safeUsername = normalizeUsername(username);

  await query(
    `
      INSERT INTO msg_participants (conversation_id, username, role, last_read_at)
      VALUES ($1::bigint, $2::text, CASE WHEN $2::text = 'admin' THEN 'admin' ELSE 'member' END, NOW())
      ON CONFLICT (conversation_id, username)
      DO UPDATE SET last_read_at = NOW()
    `,
    [conversationId, safeUsername]
  );

  return true;
}

export async function getUnreadCounts(username) {
  const safeUsername = normalizeUsername(username);
  const result = await query(
    `
      WITH me AS (
        SELECT
          u.username,
          u.role,
          CASE
            WHEN u.building_number BETWEEN 1 AND 10 THEN 'bloc' || u.building_number::text
            ELSE NULL
          END AS building_id
        FROM users u
        WHERE u.username = $1::text
        LIMIT 1
      ),
      visible AS (
        SELECT c.id
        FROM msg_conversations c
        LEFT JOIN me ON TRUE
        WHERE
          COALESCE(me.role = 'admin', FALSE)
          OR EXISTS (
            SELECT 1
            FROM msg_participants p
            WHERE p.conversation_id = c.id
              AND p.username = $1::text
          )
          OR c.scope = 'neighborhood'
          OR (me.building_id IS NOT NULL AND c.scope = 'building' AND c.building_id = me.building_id)
      ),
      counts AS (
        SELECT
          v.id AS conversation_id,
          COALESCE(
            (
              SELECT COUNT(*)::int
              FROM msg_messages m
              LEFT JOIN msg_participants p
                ON p.conversation_id = v.id
               AND p.username = $1::text
              WHERE m.conversation_id = v.id
                AND m.deleted_at IS NULL
                AND m.sender <> $1::text
                AND m.created_at::timestamptz > COALESCE(p.last_read_at, to_timestamp(0))
            ),
            0
          )::int AS unread_count
        FROM visible v
      )
      SELECT conversation_id, unread_count
      FROM counts
    `,
    [safeUsername]
  );

  const counts = {};
  let total = 0;
  for (const row of result.rows) {
    const conversationId = String(row.conversation_id);
    const unread = Number(row.unread_count || 0);
    if (unread <= 0) continue;
    counts[conversationId] = unread;
    total += unread;
  }

  return { counts, total };
}

export async function softDeleteMessage(message_id, deleted_by) {
  const messageId = Number(message_id);
  const actor = normalizeUsername(deleted_by);

  const result = await query(
    `
      UPDATE msg_messages
      SET
        deleted_at = COALESCE(deleted_at, NOW()),
        deleted_by = COALESCE(deleted_by, $2::text)
      WHERE id = $1::bigint
      RETURNING *
    `,
    [messageId, actor]
  );

  if (!result.rowCount) return null;
  return mapMessageRow(result.rows[0]);
}

export async function pinMessage(conversation_id, message_id) {
  const conversationId = Number(conversation_id);
  const messageId = Number(message_id);

  return withTransaction(async (client) => {
    const messageResult = await client.query(
      `
        SELECT id
        FROM msg_messages
        WHERE id = $1::bigint
          AND conversation_id = $2::bigint
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [messageId, conversationId]
    );

    if (!messageResult.rowCount) {
      return null;
    }

    await client.query(
      `
        UPDATE msg_messages
        SET is_pinned = FALSE
        WHERE conversation_id = $1::bigint
          AND is_pinned = TRUE
      `,
      [conversationId]
    );

    await client.query(
      `
        UPDATE msg_messages
        SET is_pinned = TRUE
        WHERE id = $1::bigint
      `,
      [messageId]
    );

    const conversationResult = await client.query(
      `
        UPDATE msg_conversations
        SET pinned_msg_id = $1::bigint,
            updated_at = NOW()
        WHERE id = $2::bigint
        RETURNING *
      `,
      [messageId, conversationId]
    );

    return mapConversationRow(conversationResult.rows[0]);
  });
}

export async function unpinMessage(conversation_id) {
  const conversationId = Number(conversation_id);

  return withTransaction(async (client) => {
    await client.query(
      `
        UPDATE msg_messages
        SET is_pinned = FALSE
        WHERE conversation_id = $1::bigint
          AND is_pinned = TRUE
      `,
      [conversationId]
    );

    const result = await client.query(
      `
        UPDATE msg_conversations
        SET pinned_msg_id = NULL,
            updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING *
      `,
      [conversationId]
    );

    if (!result.rowCount) return null;
    return mapConversationRow(result.rows[0]);
  });
}

export async function lockConversation(id) {
  const conversationId = Number(id);
  const result = await query(
    `
      UPDATE msg_conversations
      SET is_locked = TRUE,
          updated_at = NOW()
      WHERE id = $1::bigint
      RETURNING *
    `,
    [conversationId]
  );
  if (!result.rowCount) return null;
  return mapConversationRow(result.rows[0]);
}

export async function unlockConversation(id) {
  const conversationId = Number(id);
  const result = await query(
    `
      UPDATE msg_conversations
      SET is_locked = FALSE,
          updated_at = NOW()
      WHERE id = $1::bigint
      RETURNING *
    `,
    [conversationId]
  );
  if (!result.rowCount) return null;
  return mapConversationRow(result.rows[0]);
}

export async function deleteConversation(id) {
  const conversationId = Number(id);
  const result = await query(
    `
      DELETE FROM msg_conversations
      WHERE id = $1::bigint
      RETURNING id
    `,
    [conversationId]
  );
  return result.rowCount > 0;
}

export async function updateConversationTopic(id, title, topic) {
  const conversationId = Number(id);
  const result = await query(
    `
      UPDATE msg_conversations
      SET title = $2::text,
          topic = $3::text,
          updated_at = NOW()
      WHERE id = $1::bigint
      RETURNING *
    `,
    [conversationId, title == null ? null : String(title), topic == null ? null : String(topic)]
  );

  if (!result.rowCount) return null;
  return mapConversationRow(result.rows[0]);
}

export async function getMessageById(message_id) {
  const messageId = Number(message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) return null;

  const result = await query(
    `
      SELECT *
      FROM msg_messages
      WHERE id = $1::bigint
      LIMIT 1
    `,
    [messageId]
  );

  if (!result.rowCount) return null;
  return mapMessageRow(result.rows[0]);
}

export async function getUserByUsername(username) {
  const safeUsername = normalizeUsername(username);
  if (!safeUsername) return null;

  const result = await query(
    `
      SELECT id, username, role, building_number, apartment_number, avizier_permission
      FROM users
      WHERE username = $1::text
      LIMIT 1
    `,
    [safeUsername]
  );

  if (!result.rowCount) return null;

  const row = result.rows[0];
  return {
    id: Number(row.id),
    username: String(row.username),
    role: String(row.role),
    building_number: row.building_number == null ? null : Number(row.building_number),
    apartment_number: row.apartment_number == null ? null : Number(row.apartment_number),
    avizier_permission: String(row.avizier_permission || "none"),
  };
}

export async function listResidentUsernamesByBuilding(building_id) {
  const safeBuildingId = normalizeBuildingId(building_id);
  if (!safeBuildingId) return [];

  const result = await query(
    `
      SELECT username
      FROM users
      WHERE role = 'resident'
        AND ('bloc' || building_number::text) = $1::text
      ORDER BY apartment_number ASC, username ASC
    `,
    [safeBuildingId]
  );

  return result.rows.map((row) => String(row.username));
}

export async function listAllResidentUsernames() {
  const result = await query(
    `
      SELECT username
      FROM users
      WHERE role = 'resident'
      ORDER BY building_number ASC, apartment_number ASC, username ASC
    `
  );
  return result.rows.map((row) => String(row.username));
}
