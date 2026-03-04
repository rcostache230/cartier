import {
  addParticipants,
  createConversation,
  createMessage,
  findExistingDM,
  getConversationById,
  getConversationsForUser,
  getUserByUsername,
  listAllResidentUsernames,
  listResidentUsernamesByBuilding,
} from "../../../../messaging_module/lib/messaging-queries.js";
import { triggerUser } from "../../../../messaging_module/lib/pusher-server.js";
import {
  canViewConversation,
  canCreateBoard,
  canPostAnnouncement,
  isAdmin,
  isComitet,
  isReprezentantBloc,
  resolveUserBuildingId,
} from "../../../../messaging_module/lib/messaging-permissions.js";
import {
  ApiError,
  handleRouteError,
  isMessagingSchemaMissingError,
  json,
  parseBuildingId,
  parseConversationType,
  parseCursor,
  parseJsonBody,
  parseLimit,
  parseScope,
  requireSessionUser,
} from "../_shared.js";

export const runtime = "nodejs";

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeParticipants(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeUsername(item)).filter(Boolean))];
}

function canCrossBuildingDm(user) {
  if (isAdmin(user)) return true;
  return isComitet(user) || isReprezentantBloc(user);
}

export async function GET(request) {
  try {
    const user = await requireSessionUser(request);

    const searchParams = request.nextUrl.searchParams;
    const rawType = searchParams.get("type");
    const type = rawType ? parseConversationType(rawType) : null;
    const rawCursor = searchParams.get("cursor");
    const cursor = rawCursor ? parseCursor(rawCursor) : null;
    const limit = parseLimit(searchParams.get("limit"), 20, 50);
    const buildingId = user?.building_id ?? null;

    const conversations = await getConversationsForUser(
      user.username,
      buildingId,
      type,
      cursor,
      limit
    );
    const visibleConversations = conversations.filter((conversation) =>
      canViewConversation(user, conversation)
    );

    const nextCursor =
      visibleConversations.length === limit
        ? visibleConversations[visibleConversations.length - 1]?.updated_at || null
        : null;

    return json({ ok: true, conversations: visibleConversations, next_cursor: nextCursor });
  } catch (error) {
    if (isMessagingSchemaMissingError(error)) {
      return json({ ok: true, conversations: [], next_cursor: null, unavailable: true });
    }
    return handleRouteError(error);
  }
}

export async function POST(request) {
  try {
    const user = await requireSessionUser(request);
    const body = await parseJsonBody(request);

    const type = parseConversationType(body.type);

    if (type === "dm") {
      const participants = normalizeParticipants(body.participants).filter((u) => u !== user.username);
      if (participants.length !== 1) {
        throw new ApiError(400, "DM conversations require exactly one recipient in participants[]");
      }

      const recipientUsername = participants[0];
      const recipient = await getUserByUsername(recipientUsername);
      if (!recipient) {
        throw new ApiError(404, "Recipient user not found");
      }

      const sameBuilding = Number(recipient.building_number || 0) === Number(user.building_number || 0);
      if (!sameBuilding && !canCrossBuildingDm(user)) {
        throw new ApiError(403, "Cross-building DM is not allowed for this user");
      }

      const existing = await findExistingDM(user.username, recipient.username);
      if (existing) {
        const detailed = await getConversationById(existing.id);
        return json({ ok: true, existing: true, conversation: detailed || existing });
      }

      const conversation = await createConversation(
        "dm",
        body.title ? String(body.title) : null,
        body.topic ? String(body.topic) : null,
        sameBuilding ? "building" : "neighborhood",
        sameBuilding ? resolveUserBuildingId(user) : null,
        user.username
      );

      await addParticipants(conversation.id, [user.username, recipient.username], "member");
      await addParticipants(conversation.id, ["admin"], "admin");

      const firstMessage = String(body.first_message || "").trim();
      if (firstMessage) {
        await createMessage(conversation.id, user.username, firstMessage, null, null, null, null);
      }

      const detailed = await getConversationById(conversation.id);
      const responseConversation = detailed || conversation;

      const participantUsernames = Array.isArray(responseConversation.participants)
        ? responseConversation.participants.map((participant) => String(participant.username || "").trim().toLowerCase())
        : [];

      if (participantUsernames.length) {
        void Promise.allSettled(
          participantUsernames.map((username) =>
            triggerUser(username, "conversation:new", responseConversation)
          )
        );
      }

      return json({ ok: true, existing: false, conversation: responseConversation }, 201);
    }

    const scope = parseScope(body.scope || "building");
    const defaultBuilding = resolveUserBuildingId(user);
    const buildingId = scope === "building" ? parseBuildingId(body.building_id || defaultBuilding) : null;

    if (type === "board") {
      if (!canCreateBoard(user, scope, buildingId)) {
        throw new ApiError(403, "You do not have permission to create this board");
      }
    }

    if (type === "announcement") {
      if (!canPostAnnouncement(user, { scope, building_id: buildingId })) {
        throw new ApiError(403, "You do not have permission to create this announcement channel");
      }
    }

    const title = String(body.title || "").trim();
    if (!title) {
      throw new ApiError(400, "title is required");
    }

    const conversation = await createConversation(
      type,
      title,
      body.topic == null ? null : String(body.topic),
      scope,
      buildingId,
      user.username
    );

    const autoParticipants =
      scope === "building"
        ? await listResidentUsernamesByBuilding(buildingId)
        : await listAllResidentUsernames();

    if (autoParticipants.length) {
      await addParticipants(conversation.id, autoParticipants, "member");
    }

    await addParticipants(conversation.id, ["admin"], "admin");

    const extraParticipants = normalizeParticipants(body.participants);
    if (extraParticipants.length) {
      await addParticipants(conversation.id, extraParticipants, "member");
    }

    const firstMessage = String(body.first_message || "").trim();
    if (firstMessage) {
      await createMessage(conversation.id, user.username, firstMessage, null, null, null, null);
    }

    const detailed = await getConversationById(conversation.id);
    const responseConversation = detailed || conversation;

    const participantUsernames = Array.isArray(responseConversation.participants)
      ? responseConversation.participants.map((participant) => String(participant.username || "").trim().toLowerCase())
      : [];

    if (participantUsernames.length) {
      void Promise.allSettled(
        participantUsernames.map((username) =>
          triggerUser(username, "conversation:new", responseConversation)
        )
      );
    }

    return json({ ok: true, conversation: responseConversation }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
