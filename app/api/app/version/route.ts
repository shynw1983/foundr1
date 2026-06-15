import { getAppVersion, getShortAppVersion } from "../../../../lib/app-version";

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
