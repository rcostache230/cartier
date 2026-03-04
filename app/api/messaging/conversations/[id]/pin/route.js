import {
  getConversationById,
  pinMessage,
  unpinMessage,
} from "../../../../../../messaging_module/lib/messaging-queries.js";
import { triggerConversation } from "../../../../../../messaging_module/lib/pusher-server.js";
import {
  canPinMessage,
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
    const action = String(body.action || "")
      .trim()
      .toLowerCase();

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    if (!canViewConversation(user, conversation)) {
      throw new ApiError(403, "Forbidden");
    }

    if (!canPinMessage(user, conversation)) {
      throw new ApiError(403, "You do not have permission to pin messages");
    }

    if (action === "pin") {
      const messageId = parseMessageId(body.message_id);
      const updated = await pinMessage(conversationId, messageId);
      if (!updated) {
        throw new ApiError(404, "Message not found in conversation or already deleted");
      }
      void triggerConversation(conversationId, "message:pinned", {
        message_id: messageId,
        is_pinned: true,
      });
      return json({ ok: true, conversation: updated });
    }

    if (action === "unpin") {
      const updated = await unpinMessage(conversationId);
      if (!updated) {
        throw new ApiError(404, "Conversation not found");
      }
      void triggerConversation(conversationId, "message:pinned", {
        message_id: null,
        is_pinned: false,
      });
      return json({ ok: true, conversation: updated });
    }

    throw new ApiError(400, "action must be 'pin' or 'unpin'");
  } catch (error) {
    return handleRouteError(error);
  }
}
