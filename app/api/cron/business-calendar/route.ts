import { syncBusinessCalendarSources } from "../../../../lib/business-calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncBusinessCalendarSources();
  return Response.json({ ok: result.errors.length === 0, ...result }, { headers: { "Cache-Control": "no-store" } });
}
