import { scanAllActiveCompetitorMenus } from "../../../../lib/competitor-menu-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const report = await scanAllActiveCompetitorMenus();
  return Response.json(report, {
    status: report.ok ? 200 : 207,
    headers: { "Cache-Control": "no-store" }
  });
}
