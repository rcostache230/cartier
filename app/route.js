import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifySessionToken } from "../lib/security.js";

export const runtime = "nodejs";

const VERCEL_ANALYTICS_SNIPPET = `
<script>
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>
`;

function injectVercelAnalytics(html) {
  if (typeof html !== "string") return html;
  if (html.includes("/_vercel/insights/script.js")) return html;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${VERCEL_ANALYTICS_SNIPPET}\n</body>`);
  }
  return `${html}\n${VERCEL_ANALYTICS_SNIPPET}`;
}

function hasValidSessionHint(request) {
  try {
    const cookieValue = request?.cookies?.get("10blocuri_session")?.value;
    if (!cookieValue) return false;
    const parsed = verifySessionToken(cookieValue);
    return Boolean(parsed?.userId);
  } catch {
    return false;
  }
}

export async function GET(request) {
  const htmlPath = path.join(process.cwd(), "api", "templates", "index.html");
  let html = await readFile(htmlPath, "utf8");
  const hasSessionHint = hasValidSessionHint(request);
  const safePusherKey = String(process.env.PUSHER_KEY || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  html = html.replaceAll("{{PUSHER_KEY}}", safePusherKey);
  html = html.replaceAll("{{username}}", "");
  const preAuthHint = hasSessionHint
    ? `<script>window.__AUTH_SESSION_HINT__=true;document.documentElement.classList.add("session-hint");</script>
<style>
  html.session-hint #authLanding,
  html.session-hint #loginCard { display: none !important; }
  html.session-hint #app { display: block !important; }
</style>`
    : `<script>window.__AUTH_SESSION_HINT__=false;</script>`;
  html = html.replace(
    "</head>",
    `${preAuthHint}
<script>window.__VAPID_PUBLIC_KEY__=${JSON.stringify(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""
    )};</script>\n</head>`
  );
  return new Response(injectVercelAnalytics(html), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
