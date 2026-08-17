import { scheduleDailyFullInventorySync } from "../../../../lib/inventory-full-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const report = await scheduleDailyFullInventorySync();
  const ok = report.stores.every((store) => store.ok);
  return Response.json({ ok, report }, {
    status: ok ? 200 : 500,
    headers: { "Cache-Control": "no-store" }
  });
}
