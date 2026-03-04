import { readFile } from "node:fs/promises";
import path from "node:path";

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

export async function GET() {
  const htmlPath = path.join(process.cwd(), "api", "templates", "messaging.html");
  let html = await readFile(htmlPath, "utf8");
  const safePusherKey = String(process.env.PUSHER_KEY || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  html = html.replaceAll("{{PUSHER_KEY}}", safePusherKey);
  html = html.replaceAll("{{username}}", "");

  html = html.replace(
    "</head>",
    `<script>window.__PUSHER_KEY__=${JSON.stringify(process.env.PUSHER_KEY || "")};window.__PUSHER_CLUSTER__=${JSON.stringify(process.env.PUSHER_CLUSTER || "eu")};</script>\n</head>`
  );

  return new Response(injectVercelAnalytics(html), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
