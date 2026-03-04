import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";
import { verifySessionToken } from "../../../lib/security.js";

const SESSION_COOKIE = "10blocuri_session";

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function handleRouteError(error) {
  if (error instanceof ApiError) {
    const payload = { ok: false, error: error.message };
    if (error.details) payload.details = error.details;
    return json(payload, error.status);
  }

  console.error("Messaging API error:", error);
  return json({ ok: false, error: "Internal server error" }, 500);
}

export async function parseJsonBody(request) {
  try {
    const payload = await request.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload;
    }
    return {};
  } catch {
    return {};
  }
}

export function parseConversationId(rawId) {
  const value = Number(rawId);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, "Invalid conversation id");
  }
  return value;
}

export function parseMessageId(rawId) {
  const value = Number(rawId);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, "Invalid message id");
  }
  return value;
}

export function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parseCursor(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "Invalid cursor format");
  }
  return parsed.toISOString();
}

export function parseBuildingId(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (/^bloc(10|[1-9])$/.test(raw)) return raw;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 10) {
    return `bloc${numeric}`;
  }
  throw new ApiError(400, "building_id must be bloc1..bloc10");
}

export function parseScope(value, fallback = "building") {
  const raw = String(value || fallback)
    .trim()
    .toLowerCase();
  if (raw === "building" || raw === "neighborhood") return raw;
  throw new ApiError(400, "scope must be building or neighborhood");
}

export function parseConversationType(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["dm", "board", "announcement"].includes(raw)) return raw;
  throw new ApiError(400, "type must be dm, board, or announcement");
}

function formatUser(row) {
  const buildingNumber = row.building_number == null ? null : Number(row.building_number);
  return {
    id: Number(row.id),
    username: String(row.username),
    role: String(row.role),
    avizier_permission: String(row.avizier_permission || "none"),
    building_number: buildingNumber,
    apartment_number: row.apartment_number == null ? null : Number(row.apartment_number),
    phone_number: String(row.phone_number || ""),
    building_id:
      Number.isInteger(buildingNumber) && buildingNumber >= 1 && buildingNumber <= 10
        ? `bloc${buildingNumber}`
        : null,
  };
}

export async function getSessionUser(request) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  const token = verifySessionToken(cookie);
  if (!token?.userId) return null;

  const result = await query(
    `
      SELECT id, username, role, avizier_permission, building_number, apartment_number, phone_number
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [token.userId]
  );

  if (!result.rowCount) return null;
  return formatUser(result.rows[0]);
}

export async function requireSessionUser(request) {
  const user = await getSessionUser(request);
  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }
  return user;
}
