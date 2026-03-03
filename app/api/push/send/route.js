import { NextResponse } from "next/server";
import { sendPushNotification } from "../../../../lib/sendPushNotification.js";

export const runtime = "nodejs";

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request) {
  try {
    const internalKey = String(process.env.INTERNAL_API_KEY || "");
    const requestKey = String(request.headers.get("x-internal-key") || "");
    if (!internalKey || requestKey !== internalKey) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const target = body?.target || {};
    const payload = body?.payload || {};

    const targetType = String(target.type || "").trim().toLowerCase();
    if (!["all", "building", "user"].includes(targetType)) {
      return json({ error: "Invalid target.type" }, 400);
    }
    if (targetType === "building" && !Number.isInteger(Number(target.building))) {
      return json({ error: "Invalid target.building" }, 400);
    }
    if (targetType === "user" && !String(target.username || "").trim()) {
      return json({ error: "Invalid target.username" }, 400);
    }

    if (!String(payload.title || "").trim() || !String(payload.body || "").trim()) {
      return json({ error: "payload.title and payload.body are required" }, 400);
    }

    const result = await sendPushNotification(
      targetType === "building"
        ? { type: "building", building: Number(target.building) }
        : targetType === "user"
          ? { type: "user", username: String(target.username).trim() }
          : { type: "all" },
      {
        title: String(payload.title),
        body: String(payload.body),
        url: payload.url ? String(payload.url) : undefined,
        module: payload.module ? String(payload.module) : undefined,
        tag: payload.tag ? String(payload.tag) : undefined,
      }
    );

    return json({ ok: true, ...result }, 200);
  } catch (error) {
    return json({ error: error.message || "Server error" }, 500);
  }
}
