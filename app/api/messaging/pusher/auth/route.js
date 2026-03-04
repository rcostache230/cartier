import { getConversationById } from "../../../../../messaging_module/lib/messaging-queries.js";
import { isAdmin } from "../../../../../messaging_module/lib/messaging-permissions.js";
import { authorizeChannel, isPusherEnabled } from "../../../../../messaging_module/lib/pusher-server.js";
import {
  ApiError,
  getSessionUser,
  handleRouteError,
  json,
} from "../../_shared.js";

export const runtime = "nodejs";

function parseBuildingId(value) {
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

async function parseAuthPayload(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return {
      socketId: String(body.socket_id || "").trim(),
      channelName: String(body.channel_name || "").trim(),
    };
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      socketId: String(form.get("socket_id") || "").trim(),
      channelName: String(form.get("channel_name") || "").trim(),
    };
  }

  const text = await request.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    socketId: String(params.get("socket_id") || "").trim(),
    channelName: String(params.get("channel_name") || "").trim(),
  };
}

function conversationIdFromChannel(channelName) {
  const match = String(channelName || "").match(/^private-conversation-(\d+)$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function usernameFromChannel(channelName) {
  const match = String(channelName || "").match(/^private-user-([a-z0-9_\-]+)$/i);
  if (!match) return null;
  return String(match[1] || "").trim().toLowerCase();
}

function buildingFromChannel(channelName) {
  const match = String(channelName || "").match(/^presence-building-(.+)$/i);
  if (!match) return null;
  return parseBuildingId(match[1]);
}

export async function POST(request) {
  try {
    if (!isPusherEnabled()) {
      return json({ ok: false, error: "Pusher is not configured" }, 503);
    }

    const user = await getSessionUser(request);
    if (!user) {
      throw new ApiError(401, "Unauthorized");
    }

    const { socketId, channelName } = await parseAuthPayload(request);
    if (!socketId || !channelName) {
      throw new ApiError(400, "Missing socket_id or channel_name");
    }

    if (channelName.startsWith("private-conversation-")) {
      const conversationId = conversationIdFromChannel(channelName);
      if (!conversationId) throw new ApiError(400, "Invalid conversation channel");

      const conversation = await getConversationById(conversationId);
      if (!conversation) throw new ApiError(404, "Conversation not found");

      const participantUsernames = Array.isArray(conversation.participants)
        ? conversation.participants.map((participant) => String(participant.username || "").toLowerCase())
        : [];

      const allowed = isAdmin(user) || participantUsernames.includes(String(user.username).toLowerCase());
      if (!allowed) throw new ApiError(403, "Forbidden");

      const auth = authorizeChannel(socketId, channelName);
      if (!auth) throw new ApiError(500, "Pusher authorization failed");
      return json(auth);
    }

    if (channelName.startsWith("private-user-")) {
      const channelUsername = usernameFromChannel(channelName);
      if (!channelUsername) throw new ApiError(400, "Invalid user channel");

      const allowed = isAdmin(user) || channelUsername === String(user.username).toLowerCase();
      if (!allowed) throw new ApiError(403, "Forbidden");

      const auth = authorizeChannel(socketId, channelName);
      if (!auth) throw new ApiError(500, "Pusher authorization failed");
      return json(auth);
    }

    if (channelName.startsWith("presence-building-")) {
      const buildingId = buildingFromChannel(channelName);
      if (!buildingId) throw new ApiError(400, "Invalid building presence channel");

      const allowed = isAdmin(user) || String(user.building_id || "") === buildingId;
      if (!allowed) throw new ApiError(403, "Forbidden");

      const presenceData = {
        user_id: String(user.username),
        user_info: {
          username: String(user.username),
          role: String(user.role || "resident"),
          building_id: String(user.building_id || ""),
        },
      };

      const auth = authorizeChannel(socketId, channelName, presenceData);
      if (!auth) throw new ApiError(500, "Pusher authorization failed");
      return json(auth);
    }

    throw new ApiError(403, "Unsupported channel");
  } catch (error) {
    return handleRouteError(error);
  }
}
