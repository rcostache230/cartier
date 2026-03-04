import { getUnreadCounts } from "../../../../messaging_module/lib/messaging-queries.js";
import { handleRouteError, isMessagingSchemaMissingError, json, requireSessionUser } from "../_shared.js";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await requireSessionUser(request);
    const { counts, total } = await getUnreadCounts(user.username);
    return json({ ok: true, counts, total });
  } catch (error) {
    if (isMessagingSchemaMissingError(error)) {
      return json({ ok: true, counts: {}, total: 0, unavailable: true });
    }
    return handleRouteError(error);
  }
}
