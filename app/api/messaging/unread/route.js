import { getUnreadCounts } from "../../../../messaging_module/lib/messaging-queries.js";
import { handleRouteError, json, requireSessionUser } from "../_shared.js";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await requireSessionUser(request);
    const { counts, total } = await getUnreadCounts(user.username);
    return json({ ok: true, counts, total });
  } catch (error) {
    return handleRouteError(error);
  }
}
