import { requireOsSession } from "../../../../lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  return Response.json({
    key: process.env.PUSHER_KEY || "",
    cluster: process.env.PUSHER_CLUSTER || "",
    versionChannel: "store-version",
    channel: `private-os-notifications-${session.id}`
  }, { headers: { "Cache-Control": "no-store" } });
}
