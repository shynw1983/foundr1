import { NextResponse } from "next/server";
import { getProcurementDashboardData } from "../../../lib/procurement-data";

export async function GET() {
  const data = await getProcurementDashboardData();

  return NextResponse.json({
    ...data,
    exceptions: []
  });
}
