import webpush from "web-push";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
const sql = databaseUrl ? neon(databaseUrl) : null;

const vapidEmail = process.env.VAPID_EMAIL;
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidEmail && vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

/**
 * Send a push notification to a target group.
 *
 * @param {{ type: "all"|"building"|"user", building?: number, username?: string }} target
 * @param {{ title: string, body: string, url?: string, module?: string, tag?: string }} payload
 */
export async function sendPushNotification(target, payload) {
  if (!sql) throw new Error("DATABASE_URL is not configured");
  if (!vapidEmail || !vapidPublicKey || !vapidPrivateKey) {
    throw new Error("VAPID environment variables are not fully configured");
  }

  const safeTarget = target || { type: "all" };
  const safePayload = payload || {};

  let subscriptions = [];

  if (safeTarget.type === "user") {
    subscriptions = await sql`
      SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE username = ${String(safeTarget.username || "").trim()}
    `;
  } else if (safeTarget.type === "building") {
    subscriptions = await sql`
      SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE building_number = ${Number(safeTarget.building || 0)}
    `;
  } else {
    subscriptions = await sql`
      SELECT endpoint, p256dh, auth FROM push_subscriptions
    `;
  }

  if (!subscriptions.length) return { sent: 0 };

  const stale = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({
            title: String(safePayload.title || "10Blocuri"),
            body: String(safePayload.body || ""),
            url: safePayload.url || "/",
            module: safePayload.module || null,
            tag: safePayload.tag || "default",
          }),
          { TTL: 86400 }
        );
      } catch (err) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          stale.push(sub.endpoint);
        }
      }
    })
  );

  if (stale.length) {
    await Promise.all(stale.map((endpoint) => sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`));
  }

  return { sent: subscriptions.length - stale.length };
}

