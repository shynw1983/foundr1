import { NextResponse } from "next/server";
import { requireOpsSession } from "../../../lib/api-auth";
import { getProcurementDashboardData } from "../../../lib/procurement-data";

export async function GET() {
  const session = await requireOpsSession();
  if (!session) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });

  const data = await getProcurementDashboardData(session);

  return NextResponse.json({
    ...data,
    exceptions: []
  });
}
