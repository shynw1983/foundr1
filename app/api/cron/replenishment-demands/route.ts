import { sweepReplenishmentDemands } from "../../../../lib/replenishment-demand-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }
  try {
    const result = await sweepReplenishmentDemands();
    if (!result.ok) console.error("replenishment_demand_sync_incomplete", result.failedStoreIds);
    return Response.json(result, { status: result.ok ? 200 : 503, headers });
  } catch {
    console.error("replenishment_demand_sync_failed");
    return Response.json({ error: "補充依頼を集約できませんでした。次回の実行で再確認します。" }, { status: 503, headers });
  }
}
