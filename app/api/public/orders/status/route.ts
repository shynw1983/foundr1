import { cancelPublicMaamaaCustomerOrder, findPublicCustomerOrder, toPublicCustomerOrder } from "../../../../../lib/customer-orders";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URL(request.url).searchParams;
  const order = await findPublicCustomerOrder({
    orderId: params.get("orderId"),
    pickupCode: params.get("pickupCode"),
    pickupDate: params.get("pickupDate")
  });

  if (!order) {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({ order: toPublicCustomerOrder(order, url.origin) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({})) as {
    orderId?: string | null;
    pickupCode?: string | null;
    pickupDate?: string | null;
  };
  const result = await cancelPublicMaamaaCustomerOrder({
    orderId: body.orderId,
    pickupCode: body.pickupCode,
    pickupDate: body.pickupDate
  });

  if (!result.order) {
    return Response.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }
  if (result.error) {
    return Response.json({ error: result.error, order: toPublicCustomerOrder(result.order, url.origin) }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }

  await publishCustomerOrderEvent("order.updated", result.order);
  return Response.json({ order: toPublicCustomerOrder(result.order, url.origin) }, { headers: { "Cache-Control": "no-store" } });
}
