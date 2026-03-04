import {
  deleteConversation,
  getConversationById,
  lockConversation,
  unlockConversation,
  updateConversationTopic,
} from "../../../../../messaging_module/lib/messaging-queries.js";
import { triggerConversation } from "../../../../../messaging_module/lib/pusher-server.js";
import {
  canDeleteBoard,
  canEditTopic,
  canLockBoard,
  canViewConversation,
} from "../../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  json,
  parseConversationId,
  parseJsonBody,
  requireSessionUser,
} from "../../_shared.js";

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

    return json({ ok: true, conversation });
  } catch (error) {
    return handleRouteError(error);
  }
}

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

    if (action === "update") {
      if (!canEditTopic(user, conversation)) {
        throw new ApiError(403, "You do not have permission to edit this conversation");
      }

      const title = body.title == null ? conversation.title : String(body.title);
      const topic = body.topic == null ? conversation.topic : String(body.topic);
      const updated = await updateConversationTopic(conversationId, title, topic);
      return json({ ok: true, conversation: updated });
    }

    if (action === "delete") {
      if (!canDeleteBoard(user)) {
        throw new ApiError(403, "Only admin can delete conversations");
      }

      const deleted = await deleteConversation(conversationId);
      if (!deleted) {
        throw new ApiError(404, "Conversation not found");
      }
      return json({ ok: true, deleted: true });
    }

    if (action === "lock") {
      if (!canLockBoard(user)) {
        throw new ApiError(403, "Only admin can lock conversations");
      }
      const locked = await lockConversation(conversationId);
      if (locked) {
        void triggerConversation(conversationId, "conversation:locked", {
          id: conversationId,
          is_locked: true,
        });
      }
      return json({ ok: true, conversation: locked });
    }

    if (action === "unlock") {
      if (!canLockBoard(user)) {
        throw new ApiError(403, "Only admin can unlock conversations");
      }
      const unlocked = await unlockConversation(conversationId);
      if (unlocked) {
        void triggerConversation(conversationId, "conversation:locked", {
          id: conversationId,
          is_locked: false,
        });
      }
      return json({ ok: true, conversation: unlocked });
    }

    throw new ApiError(400, "action must be one of: update, delete, lock, unlock");
  } catch (error) {
    return handleRouteError(error);
  }
}
