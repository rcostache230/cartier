import { getConversationsForUser } from "../../../../messaging_module/lib/messaging-queries.js";
import { canViewConversation } from "../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  json,
  requireSessionUser,
} from "../_shared.js";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await requireSessionUser(request);
    const scopeFilterRaw = String(request.nextUrl.searchParams.get("scope") || "")
      .trim()
      .toLowerCase();

    if (scopeFilterRaw && !["building", "neighborhood"].includes(scopeFilterRaw)) {
      throw new ApiError(400, "scope must be building or neighborhood");
    }

    const boards = await getConversationsForUser(user.username, user.building_id, "board", null, 400);
    const visibleBoards = boards.filter((board) => canViewConversation(user, board));

    const grouped = {
      building: visibleBoards.filter((board) => board.scope === "building"),
      neighborhood: visibleBoards.filter((board) => board.scope === "neighborhood"),
    };

    if (scopeFilterRaw === "building") {
      grouped.neighborhood = [];
    }
    if (scopeFilterRaw === "neighborhood") {
      grouped.building = [];
    }

    return json({ ok: true, ...grouped });
  } catch (error) {
    return handleRouteError(error);
  }
}
