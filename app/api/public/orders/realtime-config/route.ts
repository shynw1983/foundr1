export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    key: process.env.PUSHER_KEY || "",
    cluster: process.env.PUSHER_CLUSTER || ""
  }, { headers: { "Cache-Control": "no-store" } });
}
