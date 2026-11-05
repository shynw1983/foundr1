import { notifyInventorySyncAttention } from "../../../../lib/inventory-sync-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Read existing command outcomes even when the Bridge itself is offline.
// This monitor never changes availability or replays an inventory command.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await notifyInventorySyncAttention();
  return Response.json(result, { status: result.migrationRequired ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
