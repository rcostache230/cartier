import crypto from "node:crypto";
import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import { ensureInitialized, query, withTransaction } from "../../../lib/db.js";
import { createUploadTarget, createViewUrl, isR2Configured } from "../../../lib/r2.js";
import {
  ABOVE_GROUND_CAPACITY_PER_BUILDING,
  BUCHAREST_TIMEZONE,
  DEFAULT_ADMIN_USERNAME,
  PARKING_TYPES,
  POLL_SCOPES,
  POLL_STATUSES,
  POLL_TYPES,
  TOTAL_BUILDINGS,
  UNDERGROUND_CAPACITY_PER_BUILDING,
} from "../../../lib/constants.js";
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from "../../../lib/security.js";

export const runtime = "nodejs";

const SESSION_COOKIE = "cartier_session";

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

async function getUserById(userId) {
  const result = await query(
    `
      SELECT id, username, role, building_number, apartment_number, phone_number
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
      SELECT id, username, role, building_number, apartment_number, phone_number, password_hash
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
      SELECT id, username, role, building_number, apartment_number, phone_number, password_hash
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
        ) AS has_voted
      FROM polls p
      ${whereClause}
      ORDER BY p.created_at DESC
    `,
    params
  );

  return result.rows.map((row) => ({ ...mapPoll(row), has_voted: Boolean(row.has_voted) }));
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

function withSessionCookie(response, userId) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: signSessionToken(userId),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
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

  if (method === "GET" && path.length === 0) {
    return json({
      service: "neighbourhood-parking-api",
      version: "4.0.0-next",
      defaults: { admin_username: DEFAULT_ADMIN_USERNAME },
      parking_types: [...PARKING_TYPES].sort(),
      endpoints: {
        claim_specific_slot: "POST /api/slots/claim",
        polls: "GET /api/polls",
        poll_create: "POST /api/polls",
        poll_vote: "POST /api/polls/<poll_id>/vote",
        poll_results: "GET /api/polls/<poll_id>/results",
        upload_presign: "POST /api/uploads/presign",
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
    const response = json({ user }, 200);
    return withSessionCookie(response, user.id);
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
    const moduleName = String(payload.module_name || "misc").trim();

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
        SELECT id, username, role, building_number, apartment_number, phone_number
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

    if (!username) throw new AppError(400, "username cannot be empty");
    if (!password) throw new AppError(400, "password cannot be empty");
    if (!["resident", "admin"].includes(role)) throw new AppError(400, "role must be resident or admin");

    if (role === "admin") {
      buildingNumber = 0;
      apartmentNumber = 0;
    } else {
      const inferredBuilding = inferBuildingFromUsername(username);
      if (inferredBuilding != null) buildingNumber = inferredBuilding;
      validateBuildingNumber(buildingNumber);
      if (!Number.isInteger(apartmentNumber) || apartmentNumber < 1 || apartmentNumber > 16) {
        throw new AppError(400, "apartment_number must be between 1 and 16");
      }
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
            phone_number
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, username, role, building_number, apartment_number, phone_number
        `,
        [username, hashPassword(password), role, buildingNumber, apartmentNumber, phoneNumber]
      );
      return json(mapUser(inserted.rows[0]), 201);
    } catch (error) {
      if (error && error.code === "23505") {
        throw new AppError(400, "username already exists");
      }
      throw error;
    }
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
    const myShared = await listSlots("ps.owner_user_id = $1", [user.id]);
    const myClaimed = await listSlots("ps.reserved_by_user_id = $1", [user.id]);
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
