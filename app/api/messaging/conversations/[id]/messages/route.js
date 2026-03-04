import {
  createMessage,
  getConversationById,
  getMessages,
  getUnreadCounts,
  markAsRead,
} from "../../../../../../messaging_module/lib/messaging-queries.js";
import {
  triggerConversation,
  triggerUser,
} from "../../../../../../messaging_module/lib/pusher-server.js";
import {
  canSendMessage,
  canViewConversation,
  isAdmin,
} from "../../../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  json,
  parseConversationId,
  parseCursor,
  parseJsonBody,
  parseLimit,
  requireSessionUser,
} from "../../../_shared.js";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const user = await requireSessionUser(request);
    const conversationId = parseConversationId(params.id);
    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    if (!canViewConversation(user, conversation)) {
      throw new ApiError(403, "Forbidden");
    }

    const before = parseCursor(request.nextUrl.searchParams.get("before"));
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 50, 100);

    const messages = await getMessages(conversationId, before, limit);
    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.created_at || null : null;

    return json({ ok: true, messages, next_cursor: nextCursor });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const user = await requireSessionUser(request);
    const conversationId = parseConversationId(params.id);
    const body = await parseJsonBody(request);

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    if (!canViewConversation(user, conversation)) {
      throw new ApiError(403, "Forbidden");
    }

    const isParticipant = Array.isArray(conversation.participants)
      ? conversation.participants.some((p) => String(p.username || "") === user.username)
      : false;

    if (conversation.is_locked && !isAdmin(user)) {
      throw new ApiError(403, "This conversation is locked");
    }

    if (!canSendMessage(user, conversation, { isParticipant })) {
      throw new ApiError(403, "You do not have permission to post in this conversation");
    }

    const content = String(body.content || "").trim();
    const attachmentKey = body.attachment_key == null ? null : String(body.attachment_key);
    const attachmentName = body.attachment_name == null ? null : String(body.attachment_name);
    const attachmentType = body.attachment_type == null ? null : String(body.attachment_type);

    if (!content && !attachmentKey) {
      throw new ApiError(400, "Message content or attachment is required");
    }

    let replyToId = null;
    if (body.reply_to_id != null) {
      const numeric = Number(body.reply_to_id);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new ApiError(400, "reply_to_id must be a valid message id");
      }
      replyToId = numeric;
    }

    const message = await createMessage(
      conversationId,
      user.username,
      content,
      replyToId,
      attachmentKey,
      attachmentName,
      attachmentType
    );

    await markAsRead(conversationId, user.username);

    const messageEventPayload = {
      id: message.id,
      sender: message.sender,
      content: message.content,
      created_at: message.created_at,
      reply_to_id: message.reply_to_id,
      attachment_key: message.attachment_key,
      attachment_name: message.attachment_name,
    };

    void triggerConversation(conversationId, "message:new", messageEventPayload);

    const recipients = Array.isArray(conversation.participants)
      ? conversation.participants
          .map((participant) => String(participant.username || "").trim().toLowerCase())
          .filter((username) => username && username !== user.username)
      : [];

    if (recipients.length) {
      void (async () => {
        await Promise.allSettled(
          recipients.map(async (recipientUsername) => {
            const unread = await getUnreadCounts(recipientUsername);
            const conversationKey = String(conversationId);
            const count = Number(unread.counts?.[conversationKey] || 0);
            await triggerUser(recipientUsername, "unread:update", {
              total: Number(unread.total || 0),
              conversation_id: conversationId,
              count,
            });
          })
        );
      })();
    }

    return json({ ok: true, message }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
