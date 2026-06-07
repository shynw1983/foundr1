import { getAppVersion, getShortAppVersion } from "../../../../lib/app-version";
import { requireOsSession } from "../../../../lib/api-auth";
import { publishStoreVersionUpdatedEvent } from "../../../../lib/order-realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = getAppVersion();
  return Response.json(
    {
      version,
      shortVersion: getShortAppVersion(version),
      checkedAt: new Date().toISOString()
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}

export async function POST(request: Request) {
  const configuredSecret = process.env.STORE_VERSION_NOTIFY_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const hasValidSecret = Boolean(configuredSecret && authorization === `Bearer ${configuredSecret}`);
  if (!hasValidSecret) {
    const session = await requireOsSession();
    if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const version = getAppVersion();
  await publishStoreVersionUpdatedEvent(version);
  return Response.json({
    ok: true,
    version,
    shortVersion: getShortAppVersion(version)
  });
}
