import { NextResponse } from "next/server";
import { requireOsSession } from "../../../lib/api-auth";
import { getProcurementDashboardData } from "../../../lib/procurement-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });

  const includeMasterData = new URL(request.url).searchParams.get("mode") !== "live";
  const data = await getProcurementDashboardData(session, { includeMasterData });

  return NextResponse.json({
    ...data,
    exceptions: []
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
