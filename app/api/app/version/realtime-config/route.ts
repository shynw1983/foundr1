import { appVersionHandlers } from "../../../../../lib/app-version-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return appVersionHandlers.realtime(request);
}
