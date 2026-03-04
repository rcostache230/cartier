import {
  getConversationById,
  markAsRead,
} from "../../../../../../messaging_module/lib/messaging-queries.js";
import { canViewConversation } from "../../../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  json,
  parseConversationId,
  requireSessionUser,
} from "../../../_shared.js";

export const runtime = "nodejs";

export async function POST(request, { params }) {
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

    await markAsRead(conversationId, user.username);
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
