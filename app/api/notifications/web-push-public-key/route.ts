import { requireOsSession } from "../../../../lib/api-auth";
import { getWebPushPublicConfig } from "../../../../lib/web-push";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  return Response.json(getWebPushPublicConfig());
}
