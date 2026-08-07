export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const storeId = String(new URL(request.url).searchParams.get("storeId") ?? "").trim();
  return Response.json({
    key: process.env.PUSHER_KEY || "",
    cluster: process.env.PUSHER_CLUSTER || "",
    menuChannel: storeId ? `menu-${storeId}` : ""
  }, { headers: { "Cache-Control": "no-store" } });
}
