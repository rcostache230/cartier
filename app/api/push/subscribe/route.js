import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { verifySessionToken } from "../../../../lib/security.js";

export const runtime = "nodejs";

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
const sql = databaseUrl ? neon(databaseUrl) : null;
const SESSION_COOKIE = "10blocuri_session";

function requireSql() {
  if (!sql) {
    throw new Error("DATABASE_URL is not configured");
  }
  return sql;
}

async function getSessionUser(request) {
  const db = requireSql();
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  const parsed = verifySessionToken(cookie);
  if (!parsed?.userId) return null;

  const rows = await db`
    SELECT id, username, role, building_number, apartment_number, avizier_permission, phone_number
    FROM users
    WHERE id = ${parsed.userId}
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: Number(row.id),
    username: String(row.username),
    role: String(row.role),
    building_number: row.building_number == null ? null : Number(row.building_number),
    apartment_number: row.apartment_number == null ? null : Number(row.apartment_number),
    avizier_permission: String(row.avizier_permission || "none"),
    phone: String(row.phone_number || ""),
  };
}

export async function GET(request) {
  try {
    const db = requireSql();
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ subscribed: false }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const endpoint = String(searchParams.get("endpoint") || "").trim();
    if (!endpoint) return NextResponse.json({ subscribed: false });

    const rows = await db`
      SELECT id FROM push_subscriptions
      WHERE username = ${user.username} AND endpoint = ${endpoint}
      LIMIT 1
    `;

    return NextResponse.json({ subscribed: rows.length > 0 });
  } catch (error) {
    return NextResponse.json({ subscribed: false, error: error.message || "Server error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = requireSql();
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const endpoint = String(body?.endpoint || "").trim();
    const p256dh = String(body?.keys?.p256dh || "").trim();
    const auth = String(body?.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    await db`
      INSERT INTO push_subscriptions
        (username, building_number, endpoint, p256dh, auth)
      VALUES (
        ${user.username},
        ${user.building_number || null},
        ${endpoint},
        ${p256dh},
        ${auth}
      )
      ON CONFLICT (endpoint) DO UPDATE SET
        username        = EXCLUDED.username,
        building_number = EXCLUDED.building_number,
        p256dh          = EXCLUDED.p256dh,
        auth            = EXCLUDED.auth,
        updated_at      = NOW()
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = requireSql();
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const endpoint = String(body?.endpoint || "").trim();

    if (endpoint) {
      await db`
        DELETE FROM push_subscriptions
        WHERE username = ${user.username} AND endpoint = ${endpoint}
      `;
    } else {
      await db`
        DELETE FROM push_subscriptions
        WHERE username = ${user.username}
      `;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}
