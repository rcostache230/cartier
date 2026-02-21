import crypto from "node:crypto";
import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import { ensureInitialized, query, withTransaction } from "../../../lib/db.js";
import {
  createUploadTarget,
  createViewUrl,
  isR2Configured,
  uploadObjectBuffer,
} from "../../../lib/r2.js";
import {
  ABOVE_GROUND_CAPACITY_PER_BUILDING,
  AVIZIER_ALLOWED_ATTACHMENT_TYPES,
  AVIZIER_MAX_ATTACHMENT_BYTES,
  AVIZIER_POST_PERMISSIONS,
  AVIZIER_SCOPES,
  BUCHAREST_TIMEZONE,
  DEFAULT_ADMIN_USERNAME,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_LISTING_TYPES,
  MARKETPLACE_POST_STATUSES,
  PARKING_TYPES,
  POLL_SCOPES,
  POLL_STATUSES,
  POLL_TYPES,
  TOTAL_BUILDINGS,
  UNDERGROUND_CAPACITY_PER_BUILDING,
} from "../../../lib/constants.js";
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from "../../../lib/security.js";

export const runtime = "nodejs";

const SESSION_COOKIE = "10blocuri_session";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const AVIZIER_ALLOWED_ATTACHMENT_TYPES_SET = new Set(
  AVIZIER_ALLOWED_ATTACHMENT_TYPES.map((value) => String(value).toLowerCase())
);

class AppError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function jsonError(message, status = 400, details = null) {
  const payload = { error: message };
  if (details) payload.details = details;
  return json(payload, status);
}

async function parseJsonBody(request) {
  try {
    const payload = await request.json();
    return payload ?? {};
  } catch {
    return {};
  }
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function inferBuildingFromUsername(username) {
  const match = normalizeUsername(username).match(/^bloc([1-9]|10)(?:_|\b)/);
  if (!match) return null;
  return Number(match[1]);
}

function validateBuildingNumber(buildingNumber) {
  const value = Number(buildingNumber);
  if (!Number.isInteger(value) || value < 1 || value > TOTAL_BUILDINGS) {
    throw new AppError(400, `building_number must be between 1 and ${TOTAL_BUILDINGS}`);
  }
  return value;
}

function validateParkingType(parkingType) {
  if (!PARKING_TYPES.includes(parkingType)) {
    throw new AppError(400, `parking_type must be one of: ${PARKING_TYPES.join(", ")}`);
  }
}

function normalizeAvizierPermission(value) {
  const normalized = String(value == null ? "none" : value)
    .trim()
    .toLowerCase();
  if (!AVIZIER_POST_PERMISSIONS.includes(normalized)) {
    throw new AppError(400, `avizier_permission must be one of: ${AVIZIER_POST_PERMISSIONS.join(", ")}`);
  }
  return normalized;
}

function normalizeMimeType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveMimeType(fileType, fileName = "") {
  const normalized = normalizeMimeType(fileType);
  if (normalized) return normalized;
  const loweredName = String(fileName || "").trim().toLowerCase();
  if (loweredName.endsWith(".pdf")) return "application/pdf";
  if (loweredName.endsWith(".jpg") || loweredName.endsWith(".jpeg")) return "image/jpeg";
  return normalized;
}

function isAllowedAvizierAttachmentType(fileType) {
  return AVIZIER_ALLOWED_ATTACHMENT_TYPES_SET.has(normalizeMimeType(fileType));
}

function canManageAllAvizier(user) {
  return user.role === "admin" || user.avizier_permission === "comitet";
}

function parseSlotDateTime(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) throw new AppError(400, `invalid datetime '${value}', use ISO format like 2026-02-14T18:30`);
  let dt = DateTime.fromISO(raw, { setZone: true });
  if (!dt.isValid) {
    dt = DateTime.fromISO(raw, { zone: "UTC" });
  }
  if (!dt.isValid) {
    throw new AppError(400, `invalid datetime '${value}', use ISO format like 2026-02-14T18:30`);
  }
  return dt;
}

function parsePollDateTimeToUtcIso(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) throw new AppError(400, `${fieldName} is required`);
  const hasOffset = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
  const dt = hasOffset
    ? DateTime.fromISO(raw, { setZone: true })
    : DateTime.fromISO(raw, { zone: BUCHAREST_TIMEZONE });
  if (!dt.isValid) throw new AppError(400, `${fieldName} must be ISO datetime`);
  return dt.toUTC().toISO({ suppressMilliseconds: true, includeOffset: true });
}

function normalizePollDateForCompare(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) throw new AppError(400, `${fieldName} is required`);
  const dt = DateTime.fromISO(raw, { setZone: true });
  if (dt.isValid) return dt.toUTC();
  const fallback = DateTime.fromISO(raw, { zone: "UTC" });
  if (fallback.isValid) return fallback.toUTC();
  throw new AppError(400, `${fieldName} must be ISO datetime`);
}

function nowIsoUtc() {
  return DateTime.utc().toISO({ suppressMilliseconds: true, includeOffset: true });
}

function mapUser(row) {
  return {
    id: Number(row.id),
    username: String(row.username),
    role: String(row.role),
    avizier_permission: String(row.avizier_permission || "none"),
    building_number: Number(row.building_number),
    apartment_number: Number(row.apartment_number),
    phone_number: String(row.phone_number || ""),
  };
}

function mapSlot(row) {
  return {
    id: Number(row.id),
    building_number: Number(row.building_number),
    owner_username: String(row.owner_username),
    owner_phone_number: String(row.owner_phone_number || ""),
    parking_space_number: String(row.parking_space_number),
    parking_type: String(row.parking_type),
    available_from: String(row.available_from),
    available_until: String(row.available_until),
    status: String(row.status),
    reserved_by_username: row.reserved_by_username == null ? null : String(row.reserved_by_username),
    reserved_by_phone_number: String(row.reserved_by_phone_number || ""),
    reservation_contact_phone: String(row.claim_phone_number || ""),
    reservation_from: row.reservation_from == null ? null : String(row.reservation_from),
    reservation_until: row.reservation_until == null ? null : String(row.reservation_until),
  };
}

function mapPoll(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ""),
    poll_type: String(row.poll_type),
    created_by: Number(row.created_by),
    scope: String(row.scope),
    building_id: row.building_id == null ? null : Number(row.building_id),
    status: String(row.status),
    allow_multiple_selections: Boolean(row.allow_multiple_selections),
    show_results_before_close: Boolean(row.show_results_before_close),
    requires_quorum: Boolean(row.requires_quorum),
    quorum_percentage: row.quorum_percentage == null ? null : Number(row.quorum_percentage),
    start_date: String(row.start_date),
    end_date: String(row.end_date),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapPollOption(row) {
  return {
    id: String(row.id),
    poll_id: String(row.poll_id),
    label: String(row.label),
    position: Number(row.position),
  };
}

function mapVote(row) {
  return {
    id: String(row.id),
    poll_id: String(row.poll_id),
    user_id: Number(row.user_id),
    option_id: String(row.option_id),
    weight: Number(row.weight),
    cast_at: String(row.cast_at),
  };
}

function mapAttachment(row) {
  return {
    id: String(row.id),
    poll_id: String(row.poll_id),
    file_url: String(row.file_url),
    file_name: String(row.file_name),
    file_type: String(row.file_type),
  };
}

function mapAvizierAnnouncement(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    message: String(row.message || ""),
    scope: String(row.scope),
    building_id: row.building_id == null ? null : Number(row.building_id),
    created_by: Number(row.created_by),
    created_by_username: String(row.created_by_username || ""),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapAvizierAttachment(row) {
  return {
    id: String(row.id),
    announcement_id: String(row.announcement_id),
    file_url: String(row.file_url),
    file_name: String(row.file_name),
    file_type: String(row.file_type),
    file_size_bytes: Number(row.file_size_bytes || 0),
  };
}

function mapMarketplacePhoto(row) {
  return {
    id: String(row.id),
    post_id: Number(row.post_id),
    file_url: String(row.file_url),
    file_name: String(row.file_name),
    file_type: String(row.file_type),
    position: Number(row.position || 1),
  };
}

function mapMarketplacePost(row) {
  return {
    id: Number(row.id),
    listing_type: String(row.listing_type),
    category: String(row.category || "other"),
    title: String(row.title),
    description: String(row.description || ""),
    price_text: String(row.price_text || ""),
    contact_phone: String(row.contact_phone || ""),
    pickup_details: String(row.pickup_details || ""),
    status: String(row.status),
    in_person_only: Boolean(row.in_person_only),
    owner_username: String(row.owner_username),
    owner_phone_number: String(row.owner_phone_number || ""),
    claimed_by_username: row.claimed_by_username == null ? null : String(row.claimed_by_username),
    claimed_by_phone_number: String(row.claimed_by_phone_number || ""),
    claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function getUserById(userId) {
  const result = await query(
    `
      SELECT id, username, role, building_number, apartment_number, phone_number
           , avizier_permission
      FROM users
      WHERE id = $1
    `,
    [userId]
  );
  if (!result.rowCount) throw new AppError(401, "authentication required");
  return mapUser(result.rows[0]);
}

async function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  const result = await query(
    `
      SELECT id, username, role, building_number, apartment_number, phone_number, avizier_permission, password_hash
      FROM users
      WHERE username = $1
    `,
    [normalized]
  );
  if (!result.rowCount) throw new AppError(404, `user '${normalized}' not found`);
  return result.rows[0];
}

async function authenticateUser(username, password) {
  const normalized = normalizeUsername(username);
  const result = await query(
    `
      SELECT id, username, role, building_number, apartment_number, phone_number, avizier_permission, password_hash
      FROM users
      WHERE username = $1
    `,
    [normalized]
  );
  if (!result.rowCount) throw new AppError(401, "invalid username or password");
  const row = result.rows[0];
  if (!row.password_hash || !verifyPassword(password, String(row.password_hash))) {
    throw new AppError(401, "invalid username or password");
  }
  return mapUser(row);
}

async function getUserAuthById(userId) {
  const result = await query(
    `
      SELECT id, username, password_hash
      FROM users
      WHERE id = $1
    `,
    [userId]
  );
  if (!result.rowCount) throw new AppError(404, "user not found");
  return result.rows[0];
}

async function changePassword({ user, currentPassword, newPassword, confirmPassword }) {
  const current = String(currentPassword || "");
  const next = String(newPassword || "");
  const confirm = String(confirmPassword || "");

  if (!current) throw new AppError(400, "current_password is required");
  if (!next) throw new AppError(400, "new_password is required");
  if (next.length < 6) throw new AppError(400, "new_password must be at least 6 characters");
  if (next.length > 128) throw new AppError(400, "new_password must be at most 128 characters");
  if (next !== confirm) throw new AppError(400, "confirm_password does not match new_password");
  if (current === next) throw new AppError(400, "new_password must be different from current_password");

  const authRow = await getUserAuthById(user.id);
  if (!authRow.password_hash || !verifyPassword(current, String(authRow.password_hash))) {
    throw new AppError(401, "current password is incorrect");
  }

  await query(
    `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
    `,
    [hashPassword(next), user.id]
  );

  return { ok: true };
}

async function updatePhoneNumber({ user, phoneNumber }) {
  const normalizedPhone = String(phoneNumber || "").trim();
  if (normalizedPhone.length > 64) {
    throw new AppError(400, "phone_number must be at most 64 characters");
  }
  const result = await query(
    `
      UPDATE users
      SET phone_number = $1
      WHERE id = $2
      RETURNING id, username, role, building_number, apartment_number, phone_number, avizier_permission
    `,
    [normalizedPhone, user.id]
  );
  if (!result.rowCount) throw new AppError(404, "user not found");
  return { ok: true, user: mapUser(result.rows[0]) };
}

async function updateUserByAdmin({ targetUserId, payload }) {
  const existingResult = await query(
    `
      SELECT id, username, role, building_number, apartment_number, phone_number, avizier_permission
      FROM users
      WHERE id = $1
    `,
    [targetUserId]
  );
  if (!existingResult.rowCount) throw new AppError(404, "user not found");
  const existing = existingResult.rows[0];

  const role =
    payload.role == null || payload.role === ""
      ? String(existing.role)
      : String(payload.role).trim().toLowerCase();
  if (!["resident", "admin"].includes(role)) {
    throw new AppError(400, "role must be resident or admin");
  }

  let buildingNumber =
    payload.building_number == null || payload.building_number === ""
      ? Number(existing.building_number)
      : Number(payload.building_number);
  let apartmentNumber =
    payload.apartment_number == null || payload.apartment_number === ""
      ? Number(existing.apartment_number)
      : Number(payload.apartment_number);
  const phoneNumber =
    payload.phone_number == null ? String(existing.phone_number || "") : String(payload.phone_number || "").trim();
  let avizierPermission =
    payload.avizier_permission == null || payload.avizier_permission === ""
      ? String(existing.avizier_permission || "none")
      : normalizeAvizierPermission(payload.avizier_permission);

  if (phoneNumber.length > 64) {
    throw new AppError(400, "phone_number must be at most 64 characters");
  }

  if (role === "admin") {
    buildingNumber = 0;
    apartmentNumber = 0;
    avizierPermission = "none";
  } else {
    validateBuildingNumber(buildingNumber);
    if (!Number.isInteger(apartmentNumber) || apartmentNumber < 1 || apartmentNumber > 16) {
      throw new AppError(400, "apartment_number must be between 1 and 16");
    }
    avizierPermission = normalizeAvizierPermission(avizierPermission);
  }

  const updated = await query(
    `
      UPDATE users
      SET role = $1,
          building_number = $2,
          apartment_number = $3,
          phone_number = $4,
          avizier_permission = $5
      WHERE id = $6
      RETURNING id, username, role, building_number, apartment_number, phone_number, avizier_permission
    `,
    [role, buildingNumber, apartmentNumber, phoneNumber, avizierPermission, targetUserId]
  );
  if (!updated.rowCount) throw new AppError(404, "user not found");
  return mapUser(updated.rows[0]);
}

async function deleteUserByAdmin({ actorUser, targetUserId }) {
  if (Number(actorUser.id) === Number(targetUserId)) {
    throw new AppError(400, "you cannot delete your own user");
  }
  try {
    const deleted = await query("DELETE FROM users WHERE id = $1 RETURNING id", [targetUserId]);
    if (!deleted.rowCount) throw new AppError(404, "user not found");
    return { deleted: true, user_id: Number(deleted.rows[0].id) };
  } catch (error) {
    if (error?.code === "23503") {
      throw new AppError(400, "user has related activity and cannot be deleted");
    }
    throw error;
  }
}

function getSessionUserId(request) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  const parsed = verifySessionToken(cookie);
  if (!parsed) return null;
  return parsed.userId;
}

async function requireUser(request) {
  const userId = getSessionUserId(request);
  if (!userId) throw new AppError(401, "authentication required");
  return getUserById(userId);
}

async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new AppError(403, "admin access required");
  return user;
}

function requirePollVisible(poll, user) {
  if (user.role === "admin") return;
  if (poll.scope === "building" && Number(poll.building_id || 0) !== Number(user.building_number || 0)) {
    throw new AppError(403, "poll restricted to another building");
  }
}

function requireAvizierVisible(announcement, user) {
  if (canManageAllAvizier(user)) return;
  if (
    announcement.scope === "building" &&
    Number(announcement.building_id || 0) !== Number(user.building_number || 0)
  ) {
    throw new AppError(403, "announcement restricted to another building");
  }
}

function ensureAvizierPostPermission({ user, scope, buildingId }) {
  if (user.role === "admin") return;
  const permission = normalizeAvizierPermission(user.avizier_permission || "none");
  if (permission === "comitet") return;
  if (permission === "reprezentant_bloc") {
    if (scope !== "building") {
      throw new AppError(403, "reprezentant_bloc can post only building announcements");
    }
    if (Number(user.building_number || 0) < 1) {
      throw new AppError(403, "reprezentant_bloc requires a valid building assignment");
    }
    if (Number(buildingId || 0) !== Number(user.building_number || 0)) {
      throw new AppError(403, "reprezentant_bloc can post only for own building");
    }
    return;
  }
  throw new AppError(403, "you do not have permission to post in avizier");
}

async function getSlotById(slotId) {
  const result = await query(
    `
      SELECT
        ps.id,
        ps.building_number,
        owner.username AS owner_username,
        owner.phone_number AS owner_phone_number,
        ps.parking_space_number,
        ps.parking_type,
        ps.available_from,
        ps.available_until,
        ps.status,
        reserver.username AS reserved_by_username,
        reserver.phone_number AS reserved_by_phone_number,
        ps.claim_phone_number,
        ps.reservation_from,
        ps.reservation_until
      FROM parking_slots ps
      JOIN users owner ON owner.id = ps.owner_user_id
      LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
      WHERE ps.id = $1
    `,
    [slotId]
  );
  if (!result.rowCount) throw new AppError(404, `slot ${slotId} not found`);
  return mapSlot(result.rows[0]);
}

async function listOpenSlots({ requestedFrom = null, requestedUntil = null, parkingType = null, buildingNumber = null, excludeOwnerUserId = null }) {
  const where = ["ps.status = 'OPEN'"];
  const params = [];

  if (parkingType != null && parkingType !== "") {
    validateParkingType(parkingType);
    params.push(parkingType);
    where.push(`ps.parking_type = $${params.length}`);
  }

  if (buildingNumber != null) {
    const building = validateBuildingNumber(buildingNumber);
    params.push(building);
    where.push(`ps.building_number = $${params.length}`);
  }

  if (excludeOwnerUserId != null) {
    params.push(Number(excludeOwnerUserId));
    where.push(`ps.owner_user_id != $${params.length}`);
  }

  if (requestedFrom != null && requestedUntil != null) {
    const fromDt = parseSlotDateTime(requestedFrom, "requested_from");
    const untilDt = parseSlotDateTime(requestedUntil, "requested_until");
    if (fromDt.toMillis() >= untilDt.toMillis()) {
      throw new AppError(400, "requested_from must be before requested_until");
    }
    params.push(String(requestedFrom));
    where.push(`ps.available_from <= $${params.length}`);
    params.push(String(requestedUntil));
    where.push(`ps.available_until >= $${params.length}`);
  } else if (requestedFrom != null || requestedUntil != null) {
    throw new AppError(400, "requested_from and requested_until must be provided together");
  }

  const result = await query(
    `
      SELECT
        ps.id,
        ps.building_number,
        owner.username AS owner_username,
        owner.phone_number AS owner_phone_number,
        ps.parking_space_number,
        ps.parking_type,
        ps.available_from,
        ps.available_until,
        ps.status,
        reserver.username AS reserved_by_username,
        reserver.phone_number AS reserved_by_phone_number,
        ps.claim_phone_number,
        ps.reservation_from,
        ps.reservation_until
      FROM parking_slots ps
      JOIN users owner ON owner.id = ps.owner_user_id
      LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY ps.available_from ASC, ps.id ASC
    `,
    params
  );

  return result.rows.map(mapSlot);
}

async function createAvailabilitySlot({ ownerUser, parkingSpaceNumber, parkingType, availableFrom, availableUntil }) {
  if (ownerUser.role === "admin") throw new AppError(403, "admin cannot share parking spots directly");
  validateBuildingNumber(ownerUser.building_number);
  validateParkingType(parkingType);

  const fromDt = parseSlotDateTime(availableFrom, "available_from");
  const untilDt = parseSlotDateTime(availableUntil, "available_until");
  if (fromDt.toMillis() >= untilDt.toMillis()) {
    throw new AppError(400, "available_from must be before available_until");
  }

  const spotNumber = String(parkingSpaceNumber || "").trim();
  if (!spotNumber) throw new AppError(400, "parking_space_number cannot be empty");

  const overlap = await query(
    `
      SELECT id
      FROM parking_slots
      WHERE owner_user_id = $1
        AND parking_space_number = $2
        AND status IN ('OPEN', 'RESERVED')
        AND NOT (available_until <= $3 OR available_from >= $4)
      LIMIT 1
    `,
    [ownerUser.id, spotNumber, String(availableFrom), String(availableUntil)]
  );
  if (overlap.rowCount) {
    throw new AppError(400, "owner already has an overlapping slot for this parking space");
  }

  const inserted = await query(
    `
      INSERT INTO parking_slots (
        building_number,
        owner_user_id,
        parking_space_number,
        parking_type,
        available_from,
        available_until
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      ownerUser.building_number,
      ownerUser.id,
      spotNumber,
      parkingType,
      String(availableFrom),
      String(availableUntil),
    ]
  );

  return getSlotById(inserted.rows[0].id);
}

function isoNoMsNoZ() {
  return new Date().toISOString().replace("Z", "").split(".")[0];
}

async function reserveSlotTx(client, row, requesterId, requestedFrom, requestedUntil, claimPhoneNumber = "") {
  const slotId = Number(row.id);
  const slotFrom = String(row.available_from);
  const slotUntil = String(row.available_until);

  const slotFromDt = parseSlotDateTime(slotFrom, "available_from");
  const slotUntilDt = parseSlotDateTime(slotUntil, "available_until");
  const requestedFromDt = parseSlotDateTime(requestedFrom, "requested_from");
  const requestedUntilDt = parseSlotDateTime(requestedUntil, "requested_until");

  if (requestedFromDt.toMillis() < slotFromDt.toMillis() || requestedUntilDt.toMillis() > slotUntilDt.toMillis()) {
    throw new AppError(400, "requested period must be within slot availability");
  }

  const updated = await client.query(
    `
      UPDATE parking_slots
      SET status = 'RESERVED',
          reserved_by_user_id = $1,
          reserved_at = $2,
          claim_phone_number = $3,
          reservation_from = $4,
          reservation_until = $5,
          available_from = $6,
          available_until = $7
      WHERE id = $8
        AND status = 'OPEN'
        AND available_from = $9
        AND available_until = $10
    `,
    [
      requesterId,
      isoNoMsNoZ(),
      String(claimPhoneNumber || "").trim(),
      String(requestedFrom),
      String(requestedUntil),
      String(requestedFrom),
      String(requestedUntil),
      slotId,
      slotFrom,
      slotUntil,
    ]
  );

  if (!updated.rowCount) {
    throw new AppError(400, "slot was reserved by another user, retry");
  }

  if (slotFromDt.toMillis() < requestedFromDt.toMillis()) {
    await client.query(
      `
        INSERT INTO parking_slots (
          building_number,
          owner_user_id,
          parking_space_number,
          parking_type,
          available_from,
          available_until,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
      `,
      [
        Number(row.building_number),
        Number(row.owner_user_id),
        String(row.parking_space_number),
        String(row.parking_type),
        slotFrom,
        String(requestedFrom),
      ]
    );
  }

  if (requestedUntilDt.toMillis() < slotUntilDt.toMillis()) {
    await client.query(
      `
        INSERT INTO parking_slots (
          building_number,
          owner_user_id,
          parking_space_number,
          parking_type,
          available_from,
          available_until,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
      `,
      [
        Number(row.building_number),
        Number(row.owner_user_id),
        String(row.parking_space_number),
        String(row.parking_type),
        String(requestedUntil),
        slotUntil,
      ]
    );
  }
}

async function reserveSpecificSlot({ requesterUser, slotId, requestedFrom, requestedUntil, claimPhoneNumber = "" }) {
  const fromDt = parseSlotDateTime(requestedFrom, "requested_from");
  const untilDt = parseSlotDateTime(requestedUntil, "requested_until");
  if (fromDt.toMillis() >= untilDt.toMillis()) {
    throw new AppError(400, "requested_from must be before requested_until");
  }

  await withTransaction(async (client) => {
    const found = await client.query(
      `
        SELECT
          id,
          building_number,
          owner_user_id,
          parking_space_number,
          parking_type,
          available_from,
          available_until,
          status
        FROM parking_slots
        WHERE id = $1
        FOR UPDATE
      `,
      [slotId]
    );

    if (!found.rowCount) throw new AppError(404, `slot ${slotId} not found`);
    const row = found.rows[0];
    if (String(row.status) !== "OPEN") throw new AppError(400, "slot is not open for reservation");
    if (Number(row.owner_user_id) === Number(requesterUser.id)) {
      throw new AppError(400, "cannot claim your own shared spot");
    }

    const slotFrom = parseSlotDateTime(row.available_from, "available_from");
    const slotUntil = parseSlotDateTime(row.available_until, "available_until");
    if (fromDt.toMillis() < slotFrom.toMillis() || untilDt.toMillis() > slotUntil.toMillis()) {
      throw new AppError(400, "requested period must be within slot availability");
    }

    await reserveSlotTx(client, row, requesterUser.id, requestedFrom, requestedUntil, claimPhoneNumber || requesterUser.phone_number);
  });

  return getSlotById(slotId);
}

async function autoReserveSlot({ requesterUser, requestedFrom, requestedUntil, parkingType = null, buildingNumber = null, claimPhoneNumber = "" }) {
  if (requesterUser.role === "admin" && buildingNumber == null) {
    throw new AppError(400, "admin must provide building_number to claim a slot");
  }

  const targetBuilding = buildingNumber != null ? validateBuildingNumber(buildingNumber) : validateBuildingNumber(requesterUser.building_number);
  const fromDt = parseSlotDateTime(requestedFrom, "requested_from");
  const untilDt = parseSlotDateTime(requestedUntil, "requested_until");
  if (fromDt.toMillis() >= untilDt.toMillis()) {
    throw new AppError(400, "requested_from must be before requested_until");
  }

  if (parkingType != null && parkingType !== "") validateParkingType(parkingType);

  let reservedSlotId = null;

  await withTransaction(async (client) => {
    const params = [requesterUser.id, targetBuilding, String(requestedFrom), String(requestedUntil)];
    const where = [
      "ps.status = 'OPEN'",
      "ps.owner_user_id != $1",
      "ps.building_number = $2",
      "ps.available_from <= $3",
      "ps.available_until >= $4",
    ];

    if (parkingType != null && parkingType !== "") {
      params.push(parkingType);
      where.push(`ps.parking_type = $${params.length}`);
    }

    const candidate = await client.query(
      `
        SELECT
          ps.id,
          ps.building_number,
          ps.owner_user_id,
          ps.parking_space_number,
          ps.parking_type,
          ps.available_from,
          ps.available_until
        FROM parking_slots ps
        WHERE ${where.join(" AND ")}
        ORDER BY ps.available_from ASC, ps.id ASC
        LIMIT 1
        FOR UPDATE
      `,
      params
    );

    if (!candidate.rowCount) throw new AppError(404, "no matching open parking slot found");

    const row = candidate.rows[0];
    await reserveSlotTx(client, row, requesterUser.id, requestedFrom, requestedUntil, claimPhoneNumber || requesterUser.phone_number);
    reservedSlotId = Number(row.id);
  });

  return getSlotById(reservedSlotId);
}

async function deleteParkingSlot({ actorUser, slotId }) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `
        SELECT id, owner_user_id, status
        FROM parking_slots
        WHERE id = $1
        FOR UPDATE
      `,
      [slotId]
    );
    if (!result.rowCount) {
      throw new AppError(404, `slot ${slotId} not found`);
    }

    const row = result.rows[0];
    if (actorUser.role !== "admin" && Number(row.owner_user_id) !== Number(actorUser.id)) {
      throw new AppError(403, "only the slot owner can delete this shared slot");
    }

    await client.query("DELETE FROM parking_slots WHERE id = $1", [slotId]);
  });

  return { deleted: true, slot_id: slotId };
}

async function listSlots(whereClause, params) {
  const result = await query(
    `
      SELECT
        ps.id,
        ps.building_number,
        owner.username AS owner_username,
        owner.phone_number AS owner_phone_number,
        ps.parking_space_number,
        ps.parking_type,
        ps.available_from,
        ps.available_until,
        ps.status,
        reserver.username AS reserved_by_username,
        reserver.phone_number AS reserved_by_phone_number,
        ps.claim_phone_number,
        ps.reservation_from,
        ps.reservation_until
      FROM parking_slots ps
      JOIN users owner ON owner.id = ps.owner_user_id
      LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
      WHERE ${whereClause}
      ORDER BY ps.available_from DESC, ps.id DESC
    `,
    params
  );
  return result.rows.map(mapSlot);
}

async function listBuildingStats() {
  const result = await query(
    `
      SELECT
        building_number,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_shared_slots,
        SUM(CASE WHEN status = 'RESERVED' THEN 1 ELSE 0 END) AS reserved_shared_slots
      FROM parking_slots
      GROUP BY building_number
    `
  );

  const byBuilding = new Map();
  for (const row of result.rows) {
    byBuilding.set(Number(row.building_number), {
      open_shared_slots: Number(row.open_shared_slots || 0),
      reserved_shared_slots: Number(row.reserved_shared_slots || 0),
    });
  }

  const stats = [];
  for (let b = 1; b <= TOTAL_BUILDINGS; b += 1) {
    const shared = byBuilding.get(b) || { open_shared_slots: 0, reserved_shared_slots: 0 };
    stats.push({
      building_number: b,
      underground_spaces: UNDERGROUND_CAPACITY_PER_BUILDING,
      above_ground_spaces: ABOVE_GROUND_CAPACITY_PER_BUILDING,
      open_shared_slots: shared.open_shared_slots,
      reserved_shared_slots: shared.reserved_shared_slots,
    });
  }
  return stats;
}

async function expirePastParkingSlots() {
  const result = await query(
    `
      SELECT id, available_until
      FROM parking_slots
      WHERE status IN ('OPEN', 'RESERVED')
    `
  );

  if (!result.rowCount) return 0;

  const nowMillis = DateTime.utc().toMillis();
  const expiredIds = [];

  for (const row of result.rows) {
    try {
      const untilDt = parseSlotDateTime(String(row.available_until || ""), "available_until");
      if (untilDt.toUTC().toMillis() <= nowMillis) {
        expiredIds.push(Number(row.id));
      }
    } catch {
      expiredIds.push(Number(row.id));
    }
  }

  if (!expiredIds.length) return 0;

  const uniqueIds = [...new Set(expiredIds.filter((value) => Number.isInteger(value) && value > 0))];
  if (!uniqueIds.length) return 0;

  await query(
    `
      UPDATE parking_slots
      SET status = 'EXPIRED'
      WHERE id = ANY($1::BIGINT[])
    `,
    [uniqueIds]
  );

  return uniqueIds.length;
}

function shouldRefreshParkingLifecycle(path) {
  if (!Array.isArray(path) || !path.length) return false;
  if (path[0] === "slots" || path[0] === "buildings" || path[0] === "dashboard") return true;
  if (path[0] === "admin" && path[1] === "slots") return true;
  if (path[0] === "profile") return true;
  return false;
}

function validateMarketplaceListingType(listingType) {
  if (!MARKETPLACE_LISTING_TYPES.includes(listingType)) {
    throw new AppError(400, `listing_type must be one of: ${MARKETPLACE_LISTING_TYPES.join(", ")}`);
  }
}

function validateMarketplaceCategory(category) {
  if (!MARKETPLACE_CATEGORIES.includes(category)) {
    throw new AppError(400, `category must be one of: ${MARKETPLACE_CATEGORIES.join(", ")}`);
  }
}

function validateMarketplaceStatus(status) {
  if (!MARKETPLACE_POST_STATUSES.includes(status)) {
    throw new AppError(400, `status must be one of: ${MARKETPLACE_POST_STATUSES.join(", ")}`);
  }
}

function normalizeMarketplacePhotos(rawPhotos) {
  if (rawPhotos == null) return [];
  if (!Array.isArray(rawPhotos)) {
    throw new AppError(400, "photos must be an array");
  }
  if (rawPhotos.length > 8) {
    throw new AppError(400, "at most 8 photos are allowed per listing");
  }
  return rawPhotos.map((photo, idx) => {
    if (typeof photo !== "object" || photo == null) {
      throw new AppError(400, `photos[${idx + 1}] must be an object`);
    }
    const fileUrl = String(photo.file_url || "").trim();
    const fileName = String(photo.file_name || "").trim();
    const fileType = String(photo.file_type || "").trim() || "application/octet-stream";
    if (!fileUrl || !fileName) {
      throw new AppError(400, `photos[${idx + 1}] requires file_url and file_name`);
    }
    return {
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      position: idx + 1,
    };
  });
}

function normalizeMarketplaceCreatePayload(payload, ownerUser) {
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    throw new AppError(400, "invalid payload");
  }

  const listingType = String(payload.listing_type || "").trim().toLowerCase();
  validateMarketplaceListingType(listingType);
  const category = String(payload.category || "other").trim().toLowerCase() || "other";
  validateMarketplaceCategory(category);

  const title = String(payload.title || "").trim();
  if (!title) {
    throw new AppError(400, "title is required");
  }
  if (title.length > 160) {
    throw new AppError(400, "title must be at most 160 characters");
  }

  const description = String(payload.description || "").trim();
  if (description.length > 2500) {
    throw new AppError(400, "description must be at most 2500 characters");
  }

  const pickupDetails = String(payload.pickup_details || "").trim();
  if (pickupDetails.length > 600) {
    throw new AppError(400, "pickup_details must be at most 600 characters");
  }

  const contactPhone = String(payload.contact_phone || ownerUser.phone_number || "").trim();
  if (contactPhone.length > 64) {
    throw new AppError(400, "contact_phone must be at most 64 characters");
  }

  let priceText = String(payload.price_text || "").trim();
  if (listingType === "sale") {
    if (!priceText) {
      throw new AppError(400, "price_text is required for sale listings");
    }
    if (priceText.length > 120) {
      throw new AppError(400, "price_text must be at most 120 characters");
    }
  } else {
    priceText = "";
  }

  const photos = normalizeMarketplacePhotos(payload.photos);

  return {
    listing_type: listingType,
    category,
    title,
    description,
    price_text: priceText,
    contact_phone: contactPhone,
    pickup_details: pickupDetails,
    in_person_only: true,
    photos,
  };
}

async function attachMarketplacePhotos(posts) {
  if (!posts.length) return posts;
  const postIds = posts.map((post) => Number(post.id));
  const photosResult = await query(
    `
      SELECT id, post_id, file_url, file_name, file_type, position
      FROM marketplace_post_photos
      WHERE post_id = ANY($1::BIGINT[])
      ORDER BY post_id ASC, position ASC, file_name ASC
    `,
    [postIds]
  );
  const byPost = new Map();
  photosResult.rows.map(mapMarketplacePhoto).forEach((photo) => {
    if (!byPost.has(photo.post_id)) {
      byPost.set(photo.post_id, []);
    }
    byPost.get(photo.post_id).push(photo);
  });
  posts.forEach((post) => {
    post.photos = byPost.get(Number(post.id)) || [];
  });
  return posts;
}

async function queryMarketplacePosts(whereClause, params = []) {
  const result = await query(
    `
      SELECT
        mp.*,
        owner.username AS owner_username,
        owner.phone_number AS owner_phone_number,
        claimer.username AS claimed_by_username,
        claimer.phone_number AS claimed_by_phone_number
      FROM marketplace_posts mp
      JOIN users owner ON owner.id = mp.owner_user_id
      LEFT JOIN users claimer ON claimer.id = mp.claimed_by_user_id
      WHERE ${whereClause}
      ORDER BY
        CASE WHEN mp.status = 'active' THEN 0 ELSE 1 END ASC,
        mp.created_at DESC,
        mp.id DESC
    `,
    params
  );
  const posts = result.rows.map(mapMarketplacePost);
  return attachMarketplacePhotos(posts);
}

async function getMarketplacePostRowForUpdate(client, postId) {
  const result = await client.query(
    `
      SELECT *
      FROM marketplace_posts
      WHERE id = $1
      FOR UPDATE
    `,
    [postId]
  );
  if (!result.rowCount) {
    throw new AppError(404, `marketplace post ${postId} not found`);
  }
  return result.rows[0];
}

async function getMarketplacePostById(postId) {
  const posts = await queryMarketplacePosts("mp.id = $1", [postId]);
  if (!posts.length) {
    throw new AppError(404, `marketplace post ${postId} not found`);
  }
  return posts[0];
}

async function createMarketplacePost({ ownerUser, payload }) {
  if (ownerUser.role !== "resident") {
    throw new AppError(403, "resident access required");
  }
  const cleaned = normalizeMarketplaceCreatePayload(payload, ownerUser);
  const now = nowIsoUtc();
  let postId = 0;
  await withTransaction(async (client) => {
    const inserted = await client.query(
      `
        INSERT INTO marketplace_posts (
          owner_user_id,
          listing_type,
          category,
          title,
          description,
          price_text,
          contact_phone,
          pickup_details,
          status,
          in_person_only,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', TRUE, $9)
        RETURNING id
      `,
      [
        ownerUser.id,
        cleaned.listing_type,
        cleaned.category,
        cleaned.title,
        cleaned.description,
        cleaned.price_text,
        cleaned.contact_phone,
        cleaned.pickup_details,
        now,
      ]
    );
    postId = Number(inserted.rows[0].id);

    for (const photo of cleaned.photos) {
      await client.query(
        `
          INSERT INTO marketplace_post_photos (id, post_id, file_url, file_name, file_type, position)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [crypto.randomUUID(), postId, photo.file_url, photo.file_name, photo.file_type, photo.position]
      );
    }
  });
  return getMarketplacePostById(postId);
}

async function claimDonationPost({ user, postId }) {
  if (user.role !== "resident") {
    throw new AppError(403, "resident access required");
  }
  const now = nowIsoUtc();
  await withTransaction(async (client) => {
    const row = await getMarketplacePostRowForUpdate(client, postId);
    validateMarketplaceStatus(String(row.status));
    if (String(row.status) !== "active") {
      throw new AppError(400, "only active listings can be claimed");
    }
    if (String(row.listing_type) !== "donation") {
      throw new AppError(400, "only donation listings can be claimed");
    }
    if (Number(row.owner_user_id) === Number(user.id)) {
      throw new AppError(400, "cannot claim your own donation");
    }
    if (row.claimed_by_user_id != null) {
      throw new AppError(400, "donation is already claimed");
    }

    const updated = await client.query(
      `
        UPDATE marketplace_posts
        SET claimed_by_user_id = $1,
            claimed_at = $2,
            updated_at = $3
        WHERE id = $4
          AND claimed_by_user_id IS NULL
      `,
      [user.id, now, now, postId]
    );
    if (!updated.rowCount) {
      throw new AppError(400, "donation was claimed by another resident");
    }
  });
  return getMarketplacePostById(postId);
}

async function markMarketplacePostComplete({ actorUser, postId }) {
  const now = nowIsoUtc();
  await withTransaction(async (client) => {
    const row = await getMarketplacePostRowForUpdate(client, postId);
    if (actorUser.role !== "admin" && Number(row.owner_user_id) !== Number(actorUser.id)) {
      throw new AppError(403, "only the owner can update this listing");
    }
    if (String(row.status) !== "active") {
      throw new AppError(400, "listing is already completed");
    }
    const targetStatus = String(row.listing_type) === "sale" ? "sold" : "donated";
    await client.query(
      `
        UPDATE marketplace_posts
        SET status = $1,
            updated_at = $2
        WHERE id = $3
      `,
      [targetStatus, now, postId]
    );
  });
  return getMarketplacePostById(postId);
}

async function deleteMarketplacePost({ actorUser, postId }) {
  await withTransaction(async (client) => {
    const row = await getMarketplacePostRowForUpdate(client, postId);
    if (actorUser.role !== "admin" && Number(row.owner_user_id) !== Number(actorUser.id)) {
      throw new AppError(403, "only the owner can delete this listing");
    }
    await client.query("DELETE FROM marketplace_posts WHERE id = $1", [postId]);
  });
  return { deleted: true, post_id: postId };
}

async function getMarketplaceDashboard(user) {
  const [activeListings, myListings, myClaimedDonations] = await Promise.all([
    queryMarketplacePosts("mp.status = 'active'", []),
    queryMarketplacePosts("mp.owner_user_id = $1", [user.id]),
    queryMarketplacePosts("mp.claimed_by_user_id = $1 AND mp.listing_type = 'donation'", [user.id]),
  ]);
  return {
    current_user: user,
    active_listings: activeListings,
    my_listings: myListings,
    my_claimed_donations: myClaimedDonations,
  };
}

async function getProfileOverview(user) {
  const [marketplaceListings, sharedParkingSpots, activePolls] = await Promise.all([
    queryMarketplacePosts("mp.owner_user_id = $1", [user.id]),
    listSlots("ps.owner_user_id = $1 AND ps.status IN ('OPEN', 'RESERVED')", [user.id]),
    listPollsForViewer({ status: "active", viewer: user }),
  ]);

  return {
    current_user: user,
    marketplace_listings: marketplaceListings,
    shared_parking_spots: sharedParkingSpots,
    active_interest_polls: activePolls,
  };
}

function normalizeAvizierAttachments(rawAttachments) {
  if (rawAttachments == null) return [];
  if (!Array.isArray(rawAttachments)) {
    throw new AppError(400, "attachments must be an array");
  }
  if (rawAttachments.length > 12) {
    throw new AppError(400, "at most 12 attachments are allowed");
  }

  return rawAttachments.map((attachment, idx) => {
    if (typeof attachment !== "object" || attachment == null) {
      throw new AppError(400, `attachments[${idx + 1}] must be an object`);
    }
    const fileUrl = String(attachment.file_url || "").trim();
    const fileName = String(attachment.file_name || "").trim();
    const fileType = normalizeMimeType(attachment.file_type || "");
    const fileSizeBytes = Number(attachment.file_size_bytes || 0);
    if (!fileUrl || !fileName || !fileType) {
      throw new AppError(400, `attachments[${idx + 1}] requires file_url, file_name, file_type`);
    }
    if (!isAllowedAvizierAttachmentType(fileType)) {
      throw new AppError(400, `attachments[${idx + 1}] file_type must be JPG or PDF`);
    }
    if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) {
      throw new AppError(400, `attachments[${idx + 1}] file_size_bytes is required`);
    }
    if (fileSizeBytes > AVIZIER_MAX_ATTACHMENT_BYTES) {
      throw new AppError(400, `attachments[${idx + 1}] exceeds 10MB limit`);
    }

    return {
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      file_size_bytes: fileSizeBytes,
    };
  });
}

function normalizeAvizierCreatePayload(payload) {
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    throw new AppError(400, "invalid payload");
  }

  const title = String(payload.title || "").trim();
  if (!title) throw new AppError(400, "title is required");
  if (title.length > 200) throw new AppError(400, "title must be at most 200 characters");

  const message = String(payload.message || "").trim();
  if (!message) throw new AppError(400, "message is required");
  if (message.length > 4000) throw new AppError(400, "message must be at most 4000 characters");

  const scope = String(payload.scope || "").trim().toLowerCase();
  if (!AVIZIER_SCOPES.includes(scope)) {
    throw new AppError(400, `scope must be one of: ${AVIZIER_SCOPES.join(", ")}`);
  }

  let buildingId = payload.building_id == null || payload.building_id === "" ? null : Number(payload.building_id);
  if (scope === "building") {
    if (buildingId == null) {
      throw new AppError(400, "building_id is required for building scope");
    }
    buildingId = validateBuildingNumber(buildingId);
  } else {
    buildingId = null;
  }

  return {
    title,
    message,
    scope,
    building_id: buildingId,
    attachments: normalizeAvizierAttachments(payload.attachments),
  };
}

async function getAvizierAttachments(announcementId) {
  const result = await query(
    `
      SELECT id, announcement_id, file_url, file_name, file_type, file_size_bytes
      FROM avizier_attachments
      WHERE announcement_id = $1
      ORDER BY file_name ASC
    `,
    [announcementId]
  );
  return result.rows.map(mapAvizierAttachment);
}

async function attachAvizierAttachments(announcements) {
  if (!announcements.length) return announcements;
  const ids = announcements.map((announcement) => announcement.id);
  const result = await query(
    `
      SELECT id, announcement_id, file_url, file_name, file_type, file_size_bytes
      FROM avizier_attachments
      WHERE announcement_id = ANY($1::TEXT[])
      ORDER BY announcement_id ASC, file_name ASC
    `,
    [ids]
  );
  const byAnnouncement = new Map();
  result.rows.map(mapAvizierAttachment).forEach((item) => {
    if (!byAnnouncement.has(item.announcement_id)) {
      byAnnouncement.set(item.announcement_id, []);
    }
    byAnnouncement.get(item.announcement_id).push(item);
  });
  announcements.forEach((announcement) => {
    announcement.attachments = byAnnouncement.get(announcement.id) || [];
  });
  return announcements;
}

async function getAvizierAnnouncementById(announcementId) {
  const result = await query(
    `
      SELECT
        a.*,
        u.username AS created_by_username
      FROM avizier_announcements a
      JOIN users u ON u.id = a.created_by
      WHERE a.id = $1
    `,
    [announcementId]
  );
  if (!result.rowCount) {
    throw new AppError(404, "announcement not found");
  }
  const announcement = mapAvizierAnnouncement(result.rows[0]);
  announcement.attachments = await getAvizierAttachments(announcement.id);
  return announcement;
}

async function listAvizierAnnouncementsForViewer({ viewer, scope = null, buildingId = null }) {
  const where = [];
  const params = [];

  if (scope != null) {
    const normalizedScope = String(scope).trim().toLowerCase();
    if (!AVIZIER_SCOPES.includes(normalizedScope)) {
      throw new AppError(400, `scope must be one of: ${AVIZIER_SCOPES.join(", ")}`);
    }
    params.push(normalizedScope);
    where.push(`a.scope = $${params.length}`);
  }

  if (buildingId != null) {
    const building = validateBuildingNumber(buildingId);
    if (!canManageAllAvizier(viewer) && Number(viewer.building_number || 0) !== building) {
      throw new AppError(403, "building filter is restricted to your building");
    }
    params.push(building);
    where.push(`a.building_id = $${params.length}`);
  }

  if (!canManageAllAvizier(viewer)) {
    params.push(Number(viewer.building_number || 0));
    where.push(`(a.scope = 'general' OR (a.scope = 'building' AND a.building_id = $${params.length}))`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await query(
    `
      SELECT
        a.*,
        u.username AS created_by_username
      FROM avizier_announcements a
      JOIN users u ON u.id = a.created_by
      ${whereClause}
      ORDER BY a.created_at DESC
    `,
    params
  );

  return attachAvizierAttachments(result.rows.map(mapAvizierAnnouncement));
}

async function createAvizierAnnouncement({ user, payload }) {
  const cleaned = normalizeAvizierCreatePayload(payload);
  ensureAvizierPostPermission({
    user,
    scope: cleaned.scope,
    buildingId: cleaned.scope === "building" ? cleaned.building_id : null,
  });

  const announcementId = crypto.randomUUID();
  const now = nowIsoUtc();

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO avizier_announcements (
          id,
          title,
          message,
          scope,
          building_id,
          created_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        announcementId,
        cleaned.title,
        cleaned.message,
        cleaned.scope,
        cleaned.building_id,
        user.id,
        now,
        now,
      ]
    );

    for (const attachment of cleaned.attachments) {
      await client.query(
        `
          INSERT INTO avizier_attachments (
            id,
            announcement_id,
            file_url,
            file_name,
            file_type,
            file_size_bytes
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          crypto.randomUUID(),
          announcementId,
          attachment.file_url,
          attachment.file_name,
          attachment.file_type,
          attachment.file_size_bytes,
        ]
      );
    }
  });

  return getAvizierAnnouncementById(announcementId);
}

async function getAvizierAnnouncementRowForUpdate(client, announcementId) {
  const result = await client.query(
    `
      SELECT *
      FROM avizier_announcements
      WHERE id = $1
      FOR UPDATE
    `,
    [announcementId]
  );
  if (!result.rowCount) {
    throw new AppError(404, "announcement not found");
  }
  return result.rows[0];
}

function ensureCanModifyAvizierAnnouncement(actorUser, row, actionLabel) {
  if (actorUser.role === "admin") return;
  if (Number(row.created_by) !== Number(actorUser.id)) {
    throw new AppError(403, `only the announcement author can ${actionLabel}`);
  }
}

async function updateAvizierAnnouncement({ actorUser, announcementId, payload }) {
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    throw new AppError(400, "invalid payload");
  }

  await withTransaction(async (client) => {
    const existing = await getAvizierAnnouncementRowForUpdate(client, announcementId);
    ensureCanModifyAvizierAnnouncement(actorUser, existing, "edit this announcement");

    const merged = {
      title: payload.title == null ? String(existing.title || "") : payload.title,
      message: payload.message == null ? String(existing.message || "") : payload.message,
      scope: payload.scope == null ? String(existing.scope || "") : payload.scope,
      building_id: payload.building_id == null ? existing.building_id : payload.building_id,
      attachments: Object.prototype.hasOwnProperty.call(payload, "attachments")
        ? payload.attachments
        : undefined,
    };
    const cleaned = normalizeAvizierCreatePayload(merged);
    const existingScope = String(existing.scope || "");
    const existingBuildingId = existing.building_id == null ? null : Number(existing.building_id);
    const nextBuildingId = cleaned.building_id == null ? null : Number(cleaned.building_id);
    const scopeChanged =
      cleaned.scope !== existingScope || Number(existingBuildingId || 0) !== Number(nextBuildingId || 0);
    if (scopeChanged) {
      ensureAvizierPostPermission({
        user: actorUser,
        scope: cleaned.scope,
        buildingId: cleaned.scope === "building" ? cleaned.building_id : null,
      });
    }

    const now = nowIsoUtc();
    await client.query(
      `
        UPDATE avizier_announcements
        SET title = $1,
            message = $2,
            scope = $3,
            building_id = $4,
            updated_at = $5
        WHERE id = $6
      `,
      [cleaned.title, cleaned.message, cleaned.scope, cleaned.building_id, now, announcementId]
    );

    if (Object.prototype.hasOwnProperty.call(payload, "attachments")) {
      await client.query("DELETE FROM avizier_attachments WHERE announcement_id = $1", [announcementId]);
      for (const attachment of cleaned.attachments) {
        await client.query(
          `
            INSERT INTO avizier_attachments (
              id,
              announcement_id,
              file_url,
              file_name,
              file_type,
              file_size_bytes
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            crypto.randomUUID(),
            announcementId,
            attachment.file_url,
            attachment.file_name,
            attachment.file_type,
            attachment.file_size_bytes,
          ]
        );
      }
    }
  });

  return getAvizierAnnouncementById(announcementId);
}

async function deleteAvizierAnnouncement({ actorUser, announcementId }) {
  await withTransaction(async (client) => {
    const existing = await getAvizierAnnouncementRowForUpdate(client, announcementId);
    ensureCanModifyAvizierAnnouncement(actorUser, existing, "delete this announcement");
    await client.query("DELETE FROM avizier_announcements WHERE id = $1", [announcementId]);
  });
  return { deleted: true, announcement_id: announcementId };
}

function parseOptionalInt(value, fieldName) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new AppError(400, `invalid integer value: ${value}`);
  }
  return parsed;
}

function validatePollPayload(payload) {
  const errors = {};

  const title = payload.title;
  if (typeof title !== "string" || !title.trim()) {
    errors.title = "required string (max 200 chars)";
  } else if (title.trim().length > 200) {
    errors.title = "must be at most 200 characters";
  }

  const description = payload.description;
  if (description != null && typeof description !== "string") {
    errors.description = "must be a string";
  }

  const pollType = payload.poll_type;
  if (!POLL_TYPES.includes(pollType)) {
    errors.poll_type = "must be yes_no, multiple_choice, or weighted";
  }

  const scope = payload.scope;
  if (!POLL_SCOPES.includes(scope)) {
    errors.scope = "must be neighbourhood or building";
  }

  const status = payload.status || "draft";
  if (!POLL_STATUSES.includes(status)) {
    errors.status = "must be draft, active, closed, or archived";
  }

  const allowMultipleSelections = Boolean(payload.allow_multiple_selections);
  if (payload.allow_multiple_selections != null && typeof payload.allow_multiple_selections !== "boolean") {
    errors.allow_multiple_selections = "must be boolean";
  }

  const showResultsBeforeClose = Boolean(payload.show_results_before_close);
  if (payload.show_results_before_close != null && typeof payload.show_results_before_close !== "boolean") {
    errors.show_results_before_close = "must be boolean";
  }

  const requiresQuorum = Boolean(payload.requires_quorum);
  if (payload.requires_quorum != null && typeof payload.requires_quorum !== "boolean") {
    errors.requires_quorum = "must be boolean";
  }

  let quorumPercentage = payload.quorum_percentage;
  if (requiresQuorum) {
    if (quorumPercentage == null) {
      errors.quorum_percentage = "required when requires_quorum is true";
    } else {
      quorumPercentage = Number(quorumPercentage);
      if (!Number.isInteger(quorumPercentage) || quorumPercentage < 1 || quorumPercentage > 100) {
        errors.quorum_percentage = "must be between 1 and 100";
      }
    }
  } else {
    quorumPercentage = null;
  }

  const startDate = payload.start_date;
  if (typeof startDate !== "string" || !startDate.trim()) {
    errors.start_date = "required ISO datetime string";
  }

  const endDate = payload.end_date;
  if (typeof endDate !== "string" || !endDate.trim()) {
    errors.end_date = "required ISO datetime string";
  }

  let buildingId = payload.building_id;
  if (scope === "building") {
    if (buildingId == null || buildingId === "") {
      errors.building_id = "required for building scope";
    }
  }
  if (buildingId != null && buildingId !== "") {
    buildingId = Number(buildingId);
    if (!Number.isInteger(buildingId) || buildingId < 1 || buildingId > 10) {
      errors.building_id = "must be between 1 and 10";
    }
  } else {
    buildingId = null;
  }

  let options = payload.options || [];
  if (pollType === "multiple_choice" || pollType === "weighted") {
    if (!Array.isArray(options)) {
      errors.options = "must be an array of option labels";
    } else {
      const normalized = options.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
      if (normalized.length < 2 || normalized.length > 10) {
        errors.options = "must include between 2 and 10 options";
      }
      options = normalized;
    }
  } else {
    options = [];
  }

  if (pollType !== "multiple_choice" && allowMultipleSelections) {
    errors.allow_multiple_selections = "only allowed for multiple_choice polls";
  }

  const attachments = payload.attachments;
  if (attachments != null) {
    if (!Array.isArray(attachments)) {
      errors.attachments = "must be an array";
    } else {
      attachments.forEach((attachment, idx) => {
        if (typeof attachment !== "object" || attachment == null) {
          errors[`attachments[${idx + 1}]`] = "must be an object";
          return;
        }
        ["file_url", "file_name", "file_type"].forEach((key) => {
          if (typeof attachment[key] !== "string" || !attachment[key].trim()) {
            errors[`attachments[${idx + 1}].${key}`] = "required string";
          }
        });
      });
    }
  }

  return {
    cleaned: {
      title: String(title || "").trim(),
      description: typeof description === "string" ? description : "",
      poll_type: String(pollType || ""),
      scope: String(scope || ""),
      building_id: buildingId,
      status: String(status || "draft"),
      allow_multiple_selections: allowMultipleSelections,
      show_results_before_close: showResultsBeforeClose,
      requires_quorum: requiresQuorum,
      quorum_percentage: quorumPercentage,
      start_date: String(startDate || ""),
      end_date: String(endDate || ""),
      options,
      attachments: Array.isArray(attachments) ? attachments : null,
    },
    errors,
  };
}

function validateVotePayload(payload) {
  const errors = {};
  const presentKeys = ["ranking", "option_ids", "option_id"].filter((key) => key in payload);
  if (!presentKeys.length) {
    errors.selections = "provide ranking, option_ids, or option_id";
    return { selections: [], errors };
  }
  if (presentKeys.length > 1) {
    errors.selections = "provide only one of ranking, option_ids, or option_id";
    return { selections: [], errors };
  }

  const key = presentKeys[0];
  let selections = payload[key];
  if (typeof selections === "string") selections = [selections];
  if (!Array.isArray(selections)) {
    errors[key] = "must be a list of option ids";
    return { selections: [], errors };
  }

  const normalized = selections.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (!normalized.length) {
    errors[key] = "must include at least one option id";
  }
  if (normalized.length !== new Set(normalized).size) {
    errors[key] = "duplicate option ids are not allowed";
  }
  return { selections: normalized, errors };
}

function ensurePollStatus(status) {
  if (!POLL_STATUSES.includes(status)) {
    throw new AppError(400, "status must be draft, active, closed, or archived");
  }
}

async function listVotesForUser(pollId, userId) {
  const result = await query(
    `
      SELECT *
      FROM votes
      WHERE poll_id = $1 AND user_id = $2
      ORDER BY cast_at ASC
    `,
    [pollId, userId]
  );
  return result.rows.map(mapVote);
}

async function getPollById(pollId) {
  const result = await query("SELECT * FROM polls WHERE id = $1", [pollId]);
  if (!result.rowCount) throw new AppError(404, "poll not found");
  return mapPoll(result.rows[0]);
}

async function getPollOptions(pollId) {
  const result = await query(
    `
      SELECT *
      FROM poll_options
      WHERE poll_id = $1
      ORDER BY position ASC
    `,
    [pollId]
  );
  return result.rows.map(mapPollOption);
}

async function getPollAttachments(pollId) {
  const result = await query(
    `
      SELECT *
      FROM poll_attachments
      WHERE poll_id = $1
      ORDER BY file_name ASC
    `,
    [pollId]
  );
  return result.rows.map(mapAttachment);
}

async function listPollsForViewer({ scope = null, status = null, buildingId = null, viewer }) {
  const params = [viewer.id];
  const where = [];

  if (scope != null) {
    if (!POLL_SCOPES.includes(scope)) throw new AppError(400, "scope must be neighbourhood or building");
    params.push(scope);
    where.push(`p.scope = $${params.length}`);
  }

  if (status != null) {
    if (!POLL_STATUSES.includes(status)) throw new AppError(400, "status must be draft, active, closed, or archived");
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }

  if (buildingId != null) {
    const building = validateBuildingNumber(buildingId);
    params.push(building);
    where.push(`p.building_id = $${params.length}`);
  }

  if (viewer.role !== "admin") {
    params.push(viewer.building_number);
    where.push(`(p.scope = 'neighbourhood' OR (p.scope = 'building' AND p.building_id = $${params.length}))`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await query(
    `
      SELECT
        p.*,
        EXISTS (
          SELECT 1 FROM votes v
          WHERE v.poll_id = p.id
            AND v.user_id = $1
        ) AS has_voted,
        (
          SELECT COUNT(DISTINCT v2.user_id)::int
          FROM votes v2
          WHERE v2.poll_id = p.id
        ) AS unique_voters,
        (
          SELECT COUNT(*)::int
          FROM users u
          WHERE u.role = 'resident'
            AND (
              p.scope = 'neighbourhood'
              OR (p.scope = 'building' AND u.building_number = p.building_id)
            )
        ) AS eligible_voters
      FROM polls p
      ${whereClause}
      ORDER BY p.created_at DESC
    `,
    params
  );

  return result.rows.map((row) => {
    const uniqueVoters = Number(row.unique_voters || 0);
    const eligibleVoters = Number(row.eligible_voters || 0);
    const turnoutPercentage = eligibleVoters ? Number(((uniqueVoters / eligibleVoters) * 100).toFixed(2)) : 0;
    return {
      ...mapPoll(row),
      has_voted: Boolean(row.has_voted),
      unique_voters: uniqueVoters,
      eligible_voters: eligibleVoters,
      turnout_percentage: turnoutPercentage,
    };
  });
}

function normalizePollDescription(description) {
  return String(description || "").trim();
}

function validatePollOptions(pollType, rawOptions) {
  if (pollType === "yes_no") return ["Yes", "No"];
  const labels = (rawOptions || []).map((v) => String(v || "").trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 10) {
    throw new AppError(400, "options must include between 2 and 10 entries");
  }
  const lowered = labels.map((l) => l.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    throw new AppError(400, "options must be unique");
  }
  if (labels.some((l) => l.length > 300)) {
    throw new AppError(400, "option labels must be at most 300 characters");
  }
  return labels;
}

async function createPoll(payload, creatorUser) {
  const title = String(payload.title || "").trim();
  if (!title) throw new AppError(400, "title is required");
  if (title.length > 200) throw new AppError(400, "title must be at most 200 characters");

  const pollType = String(payload.poll_type || "");
  const scope = String(payload.scope || "");
  const status = String(payload.status || "draft");
  const description = normalizePollDescription(payload.description);

  if (!POLL_TYPES.includes(pollType)) throw new AppError(400, "poll_type must be yes_no, multiple_choice, or weighted");
  if (!POLL_SCOPES.includes(scope)) throw new AppError(400, "scope must be neighbourhood or building");
  ensurePollStatus(status);

  let buildingId = payload.building_id;
  if (scope === "building") {
    if (buildingId == null) throw new AppError(400, "building_id is required for building scope");
    buildingId = validateBuildingNumber(buildingId);
  } else {
    buildingId = null;
  }

  let allowMultipleSelections = Boolean(payload.allow_multiple_selections);
  if (pollType !== "multiple_choice") allowMultipleSelections = false;

  const requiresQuorum = Boolean(payload.requires_quorum);
  let quorumPercentage = payload.quorum_percentage == null ? null : Number(payload.quorum_percentage);
  if (requiresQuorum) {
    if (!Number.isInteger(quorumPercentage) || quorumPercentage < 1 || quorumPercentage > 100) {
      throw new AppError(400, "quorum_percentage must be between 1 and 100");
    }
  } else {
    quorumPercentage = null;
  }

  const startDateIso = parsePollDateTimeToUtcIso(payload.start_date, "start_date");
  const endDateIso = parsePollDateTimeToUtcIso(payload.end_date, "end_date");
  const startDt = DateTime.fromISO(startDateIso, { setZone: true });
  const endDt = DateTime.fromISO(endDateIso, { setZone: true });
  if (endDt.toMillis() <= startDt.toMillis()) {
    throw new AppError(400, "end_date must be after start_date");
  }

  const labels = validatePollOptions(pollType, payload.options || []);
  const pollId = crypto.randomUUID();
  const now = nowIsoUtc();

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO polls (
          id,
          title,
          description,
          poll_type,
          created_by,
          scope,
          building_id,
          status,
          allow_multiple_selections,
          show_results_before_close,
          requires_quorum,
          quorum_percentage,
          start_date,
          end_date,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        pollId,
        title,
        description,
        pollType,
        creatorUser.id,
        scope,
        buildingId,
        status,
        allowMultipleSelections,
        Boolean(payload.show_results_before_close),
        requiresQuorum,
        quorumPercentage,
        startDateIso,
        endDateIso,
        now,
        now,
      ]
    );

    for (let i = 0; i < labels.length; i += 1) {
      await client.query(
        `
          INSERT INTO poll_options (id, poll_id, label, position)
          VALUES ($1, $2, $3, $4)
        `,
        [crypto.randomUUID(), pollId, labels[i], i + 1]
      );
    }

    if (Array.isArray(payload.attachments)) {
      for (const attachment of payload.attachments) {
        const fileUrl = String(attachment.file_url || "").trim();
        const fileName = String(attachment.file_name || "").trim();
        const fileType = String(attachment.file_type || "").trim();
        if (!fileUrl || !fileName || !fileType) {
          throw new AppError(400, "attachments require file_url, file_name, file_type");
        }
        await client.query(
          `
            INSERT INTO poll_attachments (id, poll_id, file_url, file_name, file_type)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [crypto.randomUUID(), pollId, fileUrl, fileName, fileType]
        );
      }
    }
  });

  return getPollById(pollId);
}

async function addPollAttachments(pollId, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) {
    throw new AppError(400, "attachments cannot be empty");
  }
  await getPollById(pollId);

  const added = [];
  await withTransaction(async (client) => {
    for (const attachment of attachments) {
      const fileUrl = String(attachment.file_url || "").trim();
      const fileName = String(attachment.file_name || "").trim();
      const fileType = String(attachment.file_type || "").trim();
      if (!fileUrl || !fileName || !fileType) {
        throw new AppError(400, "attachments require file_url, file_name, file_type");
      }
      const id = crypto.randomUUID();
      await client.query(
        `
          INSERT INTO poll_attachments (id, poll_id, file_url, file_name, file_type)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [id, pollId, fileUrl, fileName, fileType]
      );
      added.push({ id, poll_id: pollId, file_url: fileUrl, file_name: fileName, file_type: fileType });
    }
  });

  return added;
}

async function updatePollStatus(pollId, status) {
  ensurePollStatus(status);
  const updated = await query(
    `
      UPDATE polls
      SET status = $1,
          updated_at = $2
      WHERE id = $3
      RETURNING *
    `,
    [status, nowIsoUtc(), pollId]
  );
  if (!updated.rowCount) throw new AppError(404, "poll not found");
  return mapPoll(updated.rows[0]);
}

async function getPollResults(pollId) {
  const poll = await getPollById(pollId);
  const options = await getPollOptions(pollId);
  if (!options.length) throw new AppError(400, "poll has no options");

  const countsResult = await query(
    `
      SELECT option_id, COUNT(*)::int AS total
      FROM votes
      WHERE poll_id = $1
      GROUP BY option_id
    `,
    [pollId]
  );
  const distinctResult = await query(
    `
      SELECT COUNT(DISTINCT user_id)::int AS total
      FROM votes
      WHERE poll_id = $1
    `,
    [pollId]
  );

  const counts = new Map(options.map((opt) => [opt.id, 0]));
  for (const row of countsResult.rows) {
    counts.set(String(row.option_id), Number(row.total || 0));
  }

  const uniqueVoters = Number(distinctResult.rows[0]?.total || 0);
  let eligibleWhere = "role = $1";
  const eligibleParams = ["resident"];
  if (poll.scope === "building") {
    if (poll.building_id == null) throw new AppError(400, "poll missing building scope");
    eligibleWhere += " AND building_number = $2";
    eligibleParams.push(poll.building_id);
  }

  const eligibleResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM users
      WHERE ${eligibleWhere}
    `,
    eligibleParams
  );
  const eligibleVoters = Number(eligibleResult.rows[0]?.total || 0);
  const turnoutPercentage = eligibleVoters ? (uniqueVoters / eligibleVoters) * 100 : 0;
  const quorumMet = poll.requires_quorum ? turnoutPercentage >= Number(poll.quorum_percentage || 0) : true;
  const resultStatus = poll.requires_quorum && poll.status === "closed" && !quorumMet ? "quorum_not_met" : "valid";

  if (poll.poll_type === "weighted") {
    const votesResult = await query(
      `
        SELECT option_id, weight
        FROM votes
        WHERE poll_id = $1
      `,
      [pollId]
    );

    const optionCount = options.length;
    const points = new Map(options.map((opt) => [opt.id, 0]));
    for (const row of votesResult.rows) {
      const optionId = String(row.option_id);
      const weight = Number(row.weight);
      const extra = Math.max(optionCount - weight + 1, 0);
      points.set(optionId, Number(points.get(optionId) || 0) + extra);
    }

    let maxPoints = -Infinity;
    for (const value of points.values()) maxPoints = Math.max(maxPoints, value);
    const winners = [...points.entries()].filter(([, value]) => value === maxPoints).map(([id]) => id);

    const optionsPayload = options
      .map((opt) => ({
        id: opt.id,
        label: opt.label,
        position: opt.position,
        points: Number(points.get(opt.id) || 0),
      }))
      .sort((a, b) => (b.points - a.points) || (a.position - b.position));

    const totalVotes = [...counts.values()].reduce((acc, value) => acc + value, 0);
    const totalPoints = optionsPayload.reduce((acc, item) => acc + item.points, 0);

    return {
      poll,
      options: optionsPayload,
      total_votes: totalVotes,
      unique_voters: uniqueVoters,
      eligible_voters: eligibleVoters,
      turnout_percentage: Number(turnoutPercentage.toFixed(2)),
      quorum_met: quorumMet,
      result_status: resultStatus,
      winners,
      total_points: totalPoints,
    };
  }

  const totalVotes = [...counts.values()].reduce((acc, value) => acc + value, 0);
  const optionsPayload = options
    .map((opt) => {
      const votes = Number(counts.get(opt.id) || 0);
      const percentage = totalVotes ? (votes / totalVotes) * 100 : 0;
      return {
        id: opt.id,
        label: opt.label,
        position: opt.position,
        votes,
        percentage: Number(percentage.toFixed(2)),
      };
    })
    .sort((a, b) => (b.votes - a.votes) || (a.position - b.position));

  let maxVotes = -Infinity;
  for (const option of optionsPayload) maxVotes = Math.max(maxVotes, option.votes);
  const winners = optionsPayload.filter((opt) => opt.votes === maxVotes).map((opt) => opt.id);

  return {
    poll,
    options: optionsPayload,
    total_votes: totalVotes,
    unique_voters: uniqueVoters,
    eligible_voters: eligibleVoters,
    turnout_percentage: Number(turnoutPercentage.toFixed(2)),
    quorum_met: quorumMet,
    result_status: resultStatus,
    winners,
  };
}

async function castVote({ pollId, user, selections }) {
  const poll = await getPollById(pollId);

  if (user.role !== "resident") {
    throw new AppError(403, "resident access required");
  }
  requirePollVisible(poll, user);

  if (poll.status !== "active") {
    throw new AppError(400, "poll is not active");
  }

  const now = DateTime.utc();
  const startDt = normalizePollDateForCompare(poll.start_date, "start_date");
  const endDt = normalizePollDateForCompare(poll.end_date, "end_date");
  if (now.toMillis() < startDt.toMillis()) {
    throw new AppError(400, "poll has not started yet");
  }
  if (now.toMillis() > endDt.toMillis()) {
    throw new AppError(400, "poll has ended");
  }

  const options = await getPollOptions(pollId);
  if (!options.length) throw new AppError(400, "poll has no options");
  const optionIds = options.map((opt) => opt.id);
  const optionSet = new Set(optionIds);

  const normalizedSelections = selections.map((item) => String(item)).filter(Boolean);
  if (!normalizedSelections.length) {
    throw new AppError(400, "vote selections cannot be empty");
  }

  const existing = await listVotesForUser(pollId, user.id);
  const nowIso = nowIsoUtc();

  if (poll.poll_type === "weighted") {
    if (normalizedSelections.length !== optionIds.length) {
      throw new AppError(400, "weighted polls require ranking all options");
    }
    if (new Set(normalizedSelections).size !== optionSet.size || normalizedSelections.some((id) => !optionSet.has(id))) {
      throw new AppError(400, "weighted rankings must include each option exactly once");
    }
    if (existing.length) {
      throw new AppError(400, "vote already submitted for this poll");
    }

    const inserted = [];
    await withTransaction(async (client) => {
      for (let i = 0; i < normalizedSelections.length; i += 1) {
        const voteId = crypto.randomUUID();
        await client.query(
          `
            INSERT INTO votes (id, poll_id, user_id, option_id, weight, cast_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [voteId, pollId, user.id, normalizedSelections[i], i + 1, nowIso]
        );
        inserted.push({ id: voteId, poll_id: pollId, user_id: user.id, option_id: normalizedSelections[i], weight: i + 1, cast_at: nowIso });
      }
    });
    return inserted;
  }

  if (normalizedSelections.length !== new Set(normalizedSelections).size) {
    throw new AppError(400, "duplicate selections are not allowed");
  }
  if (normalizedSelections.some((id) => !optionSet.has(id))) {
    throw new AppError(400, "invalid option selection");
  }

  if ((poll.poll_type === "yes_no" || poll.poll_type === "multiple_choice") && !poll.allow_multiple_selections) {
    if (existing.length) throw new AppError(400, "vote already submitted for this poll");
    if (normalizedSelections.length !== 1) throw new AppError(400, "exactly one option must be selected");
  } else {
    const existingSet = new Set(existing.map((vote) => vote.option_id));
    if (normalizedSelections.some((id) => existingSet.has(id))) {
      throw new AppError(400, "already voted for one or more selected options");
    }
  }

  const inserted = [];
  await withTransaction(async (client) => {
    for (const optionId of normalizedSelections) {
      const voteId = crypto.randomUUID();
      await client.query(
        `
          INSERT INTO votes (id, poll_id, user_id, option_id, weight, cast_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [voteId, pollId, user.id, optionId, 1, nowIso]
      );
      inserted.push({ id: voteId, poll_id: pollId, user_id: user.id, option_id: optionId, weight: 1, cast_at: nowIso });
    }
  });

  return inserted;
}

function withSessionCookie(response, userId, { rememberMe = true } = {}) {
  const cookieConfig = {
    name: SESSION_COOKIE,
    value: signSessionToken(userId),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
  if (rememberMe) {
    cookieConfig.maxAge = 30 * 24 * 60 * 60;
  }
  response.cookies.set(cookieConfig);
  return response;
}

function clearSessionCookie(response) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

async function handleRequest(request, slug) {
  await ensureInitialized();

  const method = request.method.toUpperCase();
  const path = slug;

  if (shouldRefreshParkingLifecycle(path)) {
    await expirePastParkingSlots();
  }

  if (method === "GET" && path.length === 0) {
    return json({
      service: "neighbourhood-app-api",
      version: "5.1.0-next",
      defaults: { admin_username: DEFAULT_ADMIN_USERNAME },
      parking_types: [...PARKING_TYPES].sort(),
      marketplace_listing_types: [...MARKETPLACE_LISTING_TYPES],
      endpoints: {
        claim_specific_slot: "POST /api/slots/claim",
        delete_shared_slot: "POST /api/slots/<slot_id>/delete",
        profile_overview: "GET /api/profile/overview",
        profile_change_password: "POST /api/profile/password",
        profile_update_phone: "POST /api/profile/phone",
        admin_update_user: "POST /api/users/<user_id>/update",
        admin_delete_user: "POST /api/users/<user_id>/delete",
        marketplace_dashboard: "GET /api/marketplace/dashboard",
        marketplace_posts: "GET /api/marketplace/posts",
        marketplace_create_post: "POST /api/marketplace/posts",
        marketplace_claim_donation: "POST /api/marketplace/posts/<post_id>/claim",
        marketplace_complete_post: "POST /api/marketplace/posts/<post_id>/complete",
        marketplace_delete_post: "POST /api/marketplace/posts/<post_id>/delete",
        polls: "GET /api/polls",
        poll_create: "POST /api/polls",
        poll_vote: "POST /api/polls/<poll_id>/vote",
        poll_results: "GET /api/polls/<poll_id>/results",
        avizier_list: "GET /api/avizier",
        avizier_create: "POST /api/avizier",
        avizier_get: "GET /api/avizier/<announcement_id>",
        avizier_update: "POST /api/avizier/<announcement_id>/update",
        avizier_delete: "POST /api/avizier/<announcement_id>/delete",
        upload_presign: "POST /api/uploads/presign",
        upload_direct: "POST /api/uploads/direct",
      },
    });
  }

  if (method === "GET" && (path.join("/") === "health" || path.join("/") === "api/health")) {
    return json({ status: "ok", db_backend: "postgres" });
  }

  if (method === "GET" && path.length === 1 && path[0] === "health") {
    return json({ status: "ok", db_backend: "postgres" });
  }

  if (method === "POST" && path[0] === "auth" && path[1] === "login") {
    const payload = await parseJsonBody(request);
    const user = await authenticateUser(payload.username, String(payload.password || ""));
    const rememberMe = payload.remember_me == null ? true : Boolean(payload.remember_me);
    const response = json({ user }, 200);
    return withSessionCookie(response, user.id, { rememberMe });
  }

  if (method === "POST" && path[0] === "auth" && path[1] === "logout") {
    await requireUser(request);
    const response = json({ ok: true }, 200);
    return clearSessionCookie(response);
  }

  if (method === "GET" && path[0] === "auth" && path[1] === "me") {
    try {
      const user = await requireUser(request);
      return json({ authenticated: true, user }, 200);
    } catch {
      return json({ authenticated: false }, 200);
    }
  }

  if (method === "GET" && path[0] === "profile" && path[1] === "overview" && path.length === 2) {
    const user = await requireUser(request);
    return json(await getProfileOverview(user), 200);
  }

  if (method === "POST" && path[0] === "profile" && path[1] === "password" && path.length === 2) {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    return json(
      await changePassword({
        user,
        currentPassword: payload.current_password,
        newPassword: payload.new_password,
        confirmPassword: payload.confirm_password,
      }),
      200
    );
  }

  if (method === "POST" && path[0] === "profile" && path[1] === "phone" && path.length === 2) {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    return json(
      await updatePhoneNumber({
        user,
        phoneNumber: payload.phone_number,
      }),
      200
    );
  }

  if (method === "POST" && path[0] === "uploads" && path[1] === "presign") {
    const user = await requireUser(request);
    if (!isR2Configured()) {
      throw new AppError(503, "R2 storage is not configured on the server");
    }
    const payload = await parseJsonBody(request);
    if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
      return jsonError("invalid payload", 400, { payload: "object required" });
    }

    const fileName = String(payload.file_name || "").trim();
    if (!fileName) {
      return jsonError("invalid payload", 400, { file_name: "required string" });
    }
    const fileType = String(payload.file_type || "application/octet-stream").trim() || "application/octet-stream";
    const normalizedFileType = resolveMimeType(fileType, fileName);
    const moduleName = String(payload.module_name || "misc").trim().toLowerCase();
    const fileSizeBytes =
      payload.file_size_bytes == null || payload.file_size_bytes === "" ? null : Number(payload.file_size_bytes);
    if (moduleName === "avizier") {
      if (!isAllowedAvizierAttachmentType(normalizedFileType)) {
        throw new AppError(400, "Avizier accepts only JPG and PDF files");
      }
      if (fileSizeBytes != null) {
        if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) {
          throw new AppError(400, "file_size_bytes must be a positive integer");
        }
        if (fileSizeBytes > AVIZIER_MAX_ATTACHMENT_BYTES) {
          throw new AppError(400, "Avizier attachments must be at most 10MB");
        }
      }
    }

    const target = await createUploadTarget({
      userId: user.id,
      fileName,
      fileType,
      moduleName,
    });

    return json(
      {
        upload_url: target.uploadUrl,
        file_url: target.fileUrl,
        key: target.key,
        expires_in: target.expiresIn,
      },
      200
    );
  }

  if (method === "POST" && path[0] === "uploads" && path[1] === "direct") {
    const user = await requireUser(request);
    if (!isR2Configured()) {
      throw new AppError(503, "R2 storage is not configured on the server");
    }

    const form = await request.formData();
    const file = form.get("file");
    const moduleName = String(form.get("module_name") || "misc")
      .trim()
      .toLowerCase();
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      throw new AppError(400, "file is required");
    }

    const fileName = String(file.name || "").trim() || "file";
    const fileType = String(file.type || "application/octet-stream") || "application/octet-stream";
    const normalizedFileType = resolveMimeType(fileType, fileName);
    const maxBytes = moduleName === "avizier" ? AVIZIER_MAX_ATTACHMENT_BYTES : MAX_UPLOAD_BYTES;
    if (moduleName === "avizier" && !isAllowedAvizierAttachmentType(normalizedFileType)) {
      throw new AppError(400, "Avizier accepts only JPG and PDF files");
    }
    if (typeof file.size === "number" && file.size > maxBytes) {
      throw new AppError(400, `file too large (max ${Math.floor(maxBytes / 1024 / 1024)}MB)`);
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new AppError(400, `file too large (max ${Math.floor(maxBytes / 1024 / 1024)}MB)`);
    }

    const uploaded = await uploadObjectBuffer({
      userId: user.id,
      fileName,
      fileType,
      moduleName,
      body: Buffer.from(arrayBuffer),
    });

    return json(
      {
        key: uploaded.key,
        file_url: uploaded.fileUrl,
        file_name: fileName,
        file_type: fileType,
        file_size_bytes: arrayBuffer.byteLength,
      },
      201
    );
  }

  if (method === "GET" && path[0] === "uploads" && path[1] === "view") {
    await requireUser(request);
    if (!isR2Configured()) {
      throw new AppError(503, "R2 storage is not configured on the server");
    }
    const key = String(request.nextUrl.searchParams.get("key") || "").trim();
    if (!key) {
      throw new AppError(400, "key query parameter is required");
    }
    if (key.includes("..")) {
      throw new AppError(400, "invalid key");
    }

    const signedUrl = await createViewUrl(key);
    return NextResponse.redirect(signedUrl, { status: 307 });
  }

  if (method === "GET" && path.length === 1 && path[0] === "users") {
    await requireAdmin(request);
    const buildingNumber = parseOptionalInt(request.nextUrl.searchParams.get("building_number"), "building_number");
    if (buildingNumber != null) validateBuildingNumber(buildingNumber);
    const params = [];
    const where = [];
    if (buildingNumber != null) {
      params.push(buildingNumber);
      where.push(`building_number = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await query(
      `
        SELECT id, username, role, building_number, apartment_number, phone_number, avizier_permission
        FROM users
        ${whereClause}
        ORDER BY role DESC, building_number ASC, apartment_number ASC
      `,
      params
    );
    return json(result.rows.map(mapUser), 200);
  }

  if (method === "POST" && path.length === 1 && path[0] === "users") {
    await requireAdmin(request);
    const payload = await parseJsonBody(request);

    const username = normalizeUsername(payload.username);
    const role = String(payload.role || "resident");
    const password = String(payload.password || "");
    let buildingNumber = Number(payload.building_number || 0);
    let apartmentNumber = Number(payload.apartment_number || 0);
    const phoneNumber = String(payload.phone_number || "").trim();
    let avizierPermission = normalizeAvizierPermission(payload.avizier_permission == null ? "none" : payload.avizier_permission);

    if (!username) throw new AppError(400, "username cannot be empty");
    if (!password) throw new AppError(400, "password cannot be empty");
    if (!["resident", "admin"].includes(role)) throw new AppError(400, "role must be resident or admin");

    if (role === "admin") {
      buildingNumber = 0;
      apartmentNumber = 0;
      avizierPermission = "none";
    } else {
      const inferredBuilding = inferBuildingFromUsername(username);
      if (inferredBuilding != null) buildingNumber = inferredBuilding;
      validateBuildingNumber(buildingNumber);
      if (!Number.isInteger(apartmentNumber) || apartmentNumber < 1 || apartmentNumber > 16) {
        throw new AppError(400, "apartment_number must be between 1 and 16");
      }
      avizierPermission = normalizeAvizierPermission(avizierPermission);
    }

    try {
      const inserted = await query(
        `
          INSERT INTO users (
            username,
            password_hash,
            role,
            building_number,
            apartment_number,
            phone_number,
            avizier_permission
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, username, role, building_number, apartment_number, phone_number, avizier_permission
        `,
        [username, hashPassword(password), role, buildingNumber, apartmentNumber, phoneNumber, avizierPermission]
      );
      return json(mapUser(inserted.rows[0]), 201);
    } catch (error) {
      if (error && error.code === "23505") {
        throw new AppError(400, "username already exists");
      }
      throw error;
    }
  }

  if (method === "POST" && path[0] === "users" && path[2] === "update" && path.length === 3) {
    await requireAdmin(request);
    const targetUserId = Number(path[1]);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw new AppError(400, "user_id must be a valid integer");
    }
    const payload = await parseJsonBody(request);
    if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
      return jsonError("invalid payload", 400, { payload: "object required" });
    }
    return json(await updateUserByAdmin({ targetUserId, payload }), 200);
  }

  if (method === "POST" && path[0] === "users" && path[2] === "delete" && path.length === 3) {
    const adminUser = await requireAdmin(request);
    const targetUserId = Number(path[1]);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw new AppError(400, "user_id must be a valid integer");
    }
    return json(await deleteUserByAdmin({ actorUser: adminUser, targetUserId }), 200);
  }

  if (method === "POST" && path[0] === "users" && path[1] === "reset-defaults") {
    await requireAdmin(request);
    return json({ inserted_or_updated: 0 }, 200);
  }

  if (method === "POST" && path.length === 1 && path[0] === "slots") {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    const slot = await createAvailabilitySlot({
      ownerUser: user,
      parkingSpaceNumber: payload.parking_space_number,
      parkingType: String(payload.parking_type || ""),
      availableFrom: String(payload.available_from || ""),
      availableUntil: String(payload.available_until || ""),
    });
    return json(slot, 201);
  }

  if (method === "POST" && path[0] === "admin" && path[1] === "slots") {
    await requireAdmin(request);
    const payload = await parseJsonBody(request);
    const ownerRaw = await getUserByUsername(payload.owner_username);
    const owner = mapUser(ownerRaw);
    const slot = await createAvailabilitySlot({
      ownerUser: owner,
      parkingSpaceNumber: payload.parking_space_number,
      parkingType: String(payload.parking_type || ""),
      availableFrom: String(payload.available_from || ""),
      availableUntil: String(payload.available_until || ""),
    });
    return json(slot, 201);
  }

  if (method === "GET" && path[0] === "slots" && path[1] === "open") {
    const user = await requireUser(request);
    const params = request.nextUrl.searchParams;
    const requestedFrom = params.get("requested_from");
    const requestedUntil = params.get("requested_until");
    const parkingType = params.get("parking_type");
    const buildingNumber = parseOptionalInt(params.get("building_number"), "building_number");
    const excludeSelf = params.get("exclude_self") !== "0";
    const slots = await listOpenSlots({
      requestedFrom,
      requestedUntil,
      parkingType,
      buildingNumber,
      excludeOwnerUserId: excludeSelf ? user.id : null,
    });
    return json(slots, 200);
  }

  if (method === "POST" && path[0] === "slots" && path[1] === "auto-reserve") {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    const slot = await autoReserveSlot({
      requesterUser: user,
      requestedFrom: String(payload.requested_from || ""),
      requestedUntil: String(payload.requested_until || ""),
      parkingType: payload.parking_type ? String(payload.parking_type) : null,
      buildingNumber: payload.building_number == null ? null : Number(payload.building_number),
      claimPhoneNumber: String(payload.claim_phone_number || ""),
    });
    return json(slot, 200);
  }

  if (method === "POST" && path[0] === "slots" && path[1] === "claim") {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    const slotId = Number(payload.slot_id || 0);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      throw new AppError(400, "slot_id must be a valid integer");
    }
    const slot = await reserveSpecificSlot({
      requesterUser: user,
      slotId,
      requestedFrom: String(payload.requested_from || ""),
      requestedUntil: String(payload.requested_until || ""),
      claimPhoneNumber: String(payload.claim_phone_number || ""),
    });
    return json(slot, 200);
  }

  if (method === "POST" && path[0] === "slots" && path[2] === "delete" && path.length === 3) {
    const user = await requireUser(request);
    const slotId = Number(path[1]);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      throw new AppError(400, "slot_id must be a valid integer");
    }
    return json(await deleteParkingSlot({ actorUser: user, slotId }), 200);
  }

  if (method === "GET" && path[0] === "buildings" && path[1] === "stats") {
    await requireUser(request);
    return json(await listBuildingStats(), 200);
  }

  if (method === "GET" && path[0] === "dashboard") {
    const user = await requireUser(request);
    const buildingNumber = parseOptionalInt(request.nextUrl.searchParams.get("building_number"), "building_number");
    if (buildingNumber != null) validateBuildingNumber(buildingNumber);

    const sharedSpots = await listOpenSlots({
      buildingNumber,
      excludeOwnerUserId: null,
    });
    const myShared = await listSlots("ps.owner_user_id = $1 AND ps.status IN ('OPEN', 'RESERVED')", [user.id]);
    const myClaimed = await listSlots("ps.reserved_by_user_id = $1 AND ps.status = 'RESERVED'", [user.id]);
    const claimedOnMy = await listSlots("ps.owner_user_id = $1 AND ps.status = 'RESERVED'", [user.id]);

    return json(
      {
        current_user: user,
        building_stats: await listBuildingStats(),
        shared_parking_spots: sharedSpots,
        my_shared_parking_spots: myShared,
        my_shared_claimed_by_neighbours: claimedOnMy,
        my_claimed_parking_spots: myClaimed,
      },
      200
    );
  }

  if (method === "GET" && path[0] === "marketplace" && path[1] === "dashboard") {
    const user = await requireUser(request);
    return json(await getMarketplaceDashboard(user), 200);
  }

  if (method === "GET" && path[0] === "marketplace" && path[1] === "posts" && path.length === 2) {
    const user = await requireUser(request);
    const mineOnly = request.nextUrl.searchParams.get("mine") === "1";
    const status = request.nextUrl.searchParams.get("status");

    if (mineOnly) {
      const where = ["mp.owner_user_id = $1"];
      const params = [user.id];
      if (status) {
        validateMarketplaceStatus(status);
        params.push(status);
        where.push(`mp.status = $${params.length}`);
      }
      return json(await queryMarketplacePosts(where.join(" AND "), params), 200);
    }

    const where = [];
    const params = [];
    if (status) {
      validateMarketplaceStatus(status);
      params.push(status);
      where.push(`mp.status = $${params.length}`);
    } else {
      where.push("mp.status = 'active'");
    }
    return json(await queryMarketplacePosts(where.join(" AND "), params), 200);
  }

  if (method === "GET" && path[0] === "marketplace" && path[1] === "posts" && path.length === 3) {
    await requireUser(request);
    const postId = Number(path[2]);
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new AppError(400, "post_id must be a valid integer");
    }
    return json(await getMarketplacePostById(postId), 200);
  }

  if (method === "POST" && path[0] === "marketplace" && path[1] === "posts" && path.length === 2) {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    return json(await createMarketplacePost({ ownerUser: user, payload }), 201);
  }

  if (method === "POST" && path[0] === "marketplace" && path[1] === "posts" && path.length === 4 && path[3] === "claim") {
    const user = await requireUser(request);
    const postId = Number(path[2]);
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new AppError(400, "post_id must be a valid integer");
    }
    return json(await claimDonationPost({ user, postId }), 200);
  }

  if (method === "POST" && path[0] === "marketplace" && path[1] === "posts" && path.length === 4 && path[3] === "complete") {
    const user = await requireUser(request);
    const postId = Number(path[2]);
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new AppError(400, "post_id must be a valid integer");
    }
    return json(await markMarketplacePostComplete({ actorUser: user, postId }), 200);
  }

  if (method === "POST" && path[0] === "marketplace" && path[1] === "posts" && path.length === 4 && path[3] === "delete") {
    const user = await requireUser(request);
    const postId = Number(path[2]);
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new AppError(400, "post_id must be a valid integer");
    }
    return json(await deleteMarketplacePost({ actorUser: user, postId }), 200);
  }

  if (path[0] === "avizier" && method === "GET" && path.length === 1) {
    const user = await requireUser(request);
    const scope = request.nextUrl.searchParams.get("scope");
    const buildingIdRaw = request.nextUrl.searchParams.get("building_id");
    let buildingId = null;
    if (buildingIdRaw != null && buildingIdRaw !== "") {
      buildingId = Number(buildingIdRaw);
      if (!Number.isInteger(buildingId) || buildingId < 1 || buildingId > TOTAL_BUILDINGS) {
        return jsonError("invalid query parameters", 400, {
          building_id: `must be between 1 and ${TOTAL_BUILDINGS}`,
        });
      }
    }
    return json(
      await listAvizierAnnouncementsForViewer({
        viewer: user,
        scope,
        buildingId,
      }),
      200
    );
  }

  if (path[0] === "avizier" && method === "POST" && path.length === 1) {
    const user = await requireUser(request);
    const payload = await parseJsonBody(request);
    return json(await createAvizierAnnouncement({ user, payload }), 201);
  }

  if (path[0] === "avizier" && method === "GET" && path.length === 2) {
    const user = await requireUser(request);
    const announcement = await getAvizierAnnouncementById(path[1]);
    requireAvizierVisible(announcement, user);
    return json(announcement, 200);
  }

  if (path[0] === "avizier" && method === "POST" && path.length === 3 && path[2] === "update") {
    const user = await requireUser(request);
    const announcementId = String(path[1] || "").trim();
    if (!announcementId) {
      throw new AppError(400, "announcement_id is required");
    }
    const payload = await parseJsonBody(request);
    return json(
      await updateAvizierAnnouncement({
        actorUser: user,
        announcementId,
        payload,
      }),
      200
    );
  }

  if (path[0] === "avizier" && method === "POST" && path.length === 3 && path[2] === "delete") {
    const user = await requireUser(request);
    const announcementId = String(path[1] || "").trim();
    if (!announcementId) {
      throw new AppError(400, "announcement_id is required");
    }
    return json(
      await deleteAvizierAnnouncement({
        actorUser: user,
        announcementId,
      }),
      200
    );
  }

  if (path[0] === "polls" && method === "GET" && path.length === 1) {
    const user = await requireUser(request);
    const scope = request.nextUrl.searchParams.get("scope");
    const status = request.nextUrl.searchParams.get("status");
    const buildingIdRaw = request.nextUrl.searchParams.get("building_id");
    let buildingId = null;
    if (buildingIdRaw != null && buildingIdRaw !== "") {
      buildingId = Number(buildingIdRaw);
      if (!Number.isInteger(buildingId) || buildingId < 1 || buildingId > 10) {
        return jsonError("invalid query parameters", 400, { building_id: "must be between 1 and 10" });
      }
    }
    const polls = await listPollsForViewer({ scope, status, buildingId, viewer: user });
    return json(polls, 200);
  }

  if (path[0] === "polls" && method === "POST" && path.length === 1) {
    const user = await requireAdmin(request);
    const payload = await parseJsonBody(request);
    if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
      return jsonError("invalid payload", 400, { payload: "object required" });
    }

    const { cleaned, errors } = validatePollPayload(payload);
    if (Object.keys(errors).length) {
      return jsonError("invalid poll payload", 400, errors);
    }

    const poll = await createPoll(cleaned, user);
    const options = await getPollOptions(poll.id);
    const attachments = await getPollAttachments(poll.id);
    return json({ poll, options, attachments }, 201);
  }

  if (path[0] === "polls" && method === "GET" && path.length === 2) {
    const user = await requireUser(request);
    const pollId = path[1];
    const poll = await getPollById(pollId);
    requirePollVisible(poll, user);
    const options = await getPollOptions(pollId);
    const attachments = await getPollAttachments(pollId);
    const votes = await listVotesForUser(pollId, user.id);
    return json(
      {
        poll,
        options,
        attachments,
        has_voted: votes.length > 0,
        my_votes: votes,
      },
      200
    );
  }

  if (path[0] === "polls" && method === "POST" && path.length === 3 && path[2] === "attachments") {
    await requireAdmin(request);
    const pollId = path[1];
    const payload = await parseJsonBody(request);
    if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
      return jsonError("invalid payload", 400, { payload: "object required" });
    }
    const attachments = payload.attachments;
    if (!Array.isArray(attachments) || !attachments.length) {
      return jsonError("invalid attachments payload", 400, { attachments: "must be a non-empty array" });
    }
    const added = await addPollAttachments(pollId, attachments);
    return json(added, 201);
  }

  if (path[0] === "polls" && method === "POST" && path.length === 3 && ["activate", "close", "archive"].includes(path[2])) {
    await requireAdmin(request);
    const pollId = path[1];
    const targetStatus = path[2] === "activate" ? "active" : path[2] === "close" ? "closed" : "archived";
    const poll = await updatePollStatus(pollId, targetStatus);
    return json(poll, 200);
  }

  if (path[0] === "polls" && method === "POST" && path.length === 3 && path[2] === "vote") {
    const user = await requireUser(request);
    const pollId = path[1];
    const payload = await parseJsonBody(request);
    if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
      return jsonError("invalid payload", 400, { payload: "object required" });
    }

    const { selections, errors } = validateVotePayload(payload);
    if (Object.keys(errors).length) {
      return jsonError("invalid vote payload", 400, errors);
    }

    const votes = await castVote({ pollId, user, selections });
    return json(votes, 201);
  }

  if (path[0] === "polls" && method === "GET" && path.length === 3 && path[2] === "results") {
    const user = await requireUser(request);
    const pollId = path[1];
    const poll = await getPollById(pollId);
    requirePollVisible(poll, user);
    if (poll.status !== "closed" && !poll.show_results_before_close && user.role !== "admin") {
      throw new AppError(403, "results are hidden until poll closes");
    }
    return json(await getPollResults(pollId), 200);
  }

  return jsonError("not found", 404);
}

function getSlugArray(params) {
  if (!params?.slug) return [];
  return Array.isArray(params.slug) ? params.slug : [params.slug];
}

async function run(request, context) {
  try {
    const slug = getSlugArray(context?.params);
    return await handleRequest(request, slug);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonError(error.message, error.status, error.details || null);
    }
    if (error instanceof Error && /Missing Postgres connection string/i.test(error.message || "")) {
      return jsonError(
        "Missing Postgres connection string. Set POSTGRES_URL or DATABASE_URL in Vercel project env vars.",
        503
      );
    }
    console.error("Unhandled API error", error);
    return jsonError("internal server error", 500);
  }
}

export async function GET(request, context) {
  return run(request, context);
}

export async function POST(request, context) {
  return run(request, context);
}
