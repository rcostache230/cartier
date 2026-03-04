import {
  getConversationById,
  getMessageById,
  softDeleteMessage,
} from "../../../../../../messaging_module/lib/messaging-queries.js";
import { triggerConversation } from "../../../../../../messaging_module/lib/pusher-server.js";
import {
  canModerate,
  canViewConversation,
} from "../../../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  json,
  parseConversationId,
  parseJsonBody,
  parseMessageId,
  requireSessionUser,
} from "../../../_shared.js";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const user = await requireSessionUser(request);
    const conversationId = parseConversationId(params.id);
    const body = await parseJsonBody(request);
    const messageId = parseMessageId(body.message_id);

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    if (!canViewConversation(user, conversation)) {
      throw new ApiError(403, "Forbidden");
    }

    const message = await getMessageById(messageId);
    if (!message || Number(message.conversation_id) !== conversationId) {
      throw new ApiError(404, "Message not found");
    }

    const isOwnMessage = String(message.sender || "") === user.username;
    if (!isOwnMessage && !canModerate(user, conversation)) {
      throw new ApiError(403, "You do not have permission to moderate this message");
    }

    const deleted = await softDeleteMessage(messageId, user.username);
    void triggerConversation(conversationId, "message:deleted", {
      id: messageId,
      deleted_by: user.username,
    });
    return json({ ok: true, message: deleted });
  } catch (error) {
    return handleRouteError(error);
  }
}
