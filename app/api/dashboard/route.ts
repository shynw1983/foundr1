import { NextResponse } from "next/server";
import {
  exceptions,
  orders as mockOrders,
  priceSignals
} from "../../../lib/mock-data";
import { getProcurementDashboardData } from "../../../lib/procurement-data";

export async function GET() {
  const data = await getProcurementDashboardData();

  return NextResponse.json({
    ...data,
    orders: data.orders.length > 0 ? data.orders : mockOrders,
    exceptions,
    priceSignals
  });
}
