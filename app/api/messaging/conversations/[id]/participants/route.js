import {
  addParticipants,
  getConversationById,
  removeParticipants,
} from "../../../../../../messaging_module/lib/messaging-queries.js";
import {
  canManageParticipants,
  canViewConversation,
  isAdmin,
} from "../../../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  json,
  parseConversationId,
  parseJsonBody,
  requireSessionUser,
} from "../../../_shared.js";

export const runtime = "nodejs";

function normalizeUsernames(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
}

function isUsernameInBuilding(username, buildingId) {
  if (!buildingId) return false;
  return String(username || "").startsWith(`${buildingId}_apt`);
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

    if (!canManageParticipants(user, conversation)) {
      throw new ApiError(403, "You do not have permission to manage participants");
    }

    const usernames = normalizeUsernames(body.usernames);
    if (!usernames.length) {
      throw new ApiError(400, "usernames must contain at least one username");
    }

    if (conversation.scope === "building") {
      const invalid = usernames.find((username) => !isUsernameInBuilding(username, conversation.building_id));
      if (invalid) {
        throw new ApiError(400, `Username ${invalid} is outside this building`);
      }
    }

    if (action === "add") {
      let role = "member";
      if (isAdmin(user) && ["member", "moderator", "admin"].includes(String(body.role || ""))) {
        role = String(body.role);
      }
      await addParticipants(conversationId, usernames, role);
      const updated = await getConversationById(conversationId);
      return json({ ok: true, conversation: updated });
    }

    if (action === "remove") {
      if (!isAdmin(user) && usernames.includes("admin")) {
        throw new ApiError(403, "Only admin can remove admin participant rows");
      }
      await removeParticipants(conversationId, usernames);
      const updated = await getConversationById(conversationId);
      return json({ ok: true, conversation: updated });
    }

    throw new ApiError(400, "action must be 'add' or 'remove'");
  } catch (error) {
    return handleRouteError(error);
  }
}
