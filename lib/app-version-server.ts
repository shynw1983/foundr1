import { timingSafeEqual } from "node:crypto";
import { getAppVersion } from "./app-version";
import { createAppVersionHandlers } from "./app-version-http";

function matchesBearer(authorization: string, secret: string | undefined) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(authorization);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export const appVersionHandlers = createAppVersionHandlers({
  getVersion: getAppVersion,
  async authorizePublish(request, app) {
    const authorization = request.headers.get("authorization") || "";
    if (matchesBearer(authorization, process.env.APP_VERSION_NOTIFY_SECRET)) return true;
    // Keep the existing Store deployment hook scoped to Store.
    if (app === "store" && matchesBearer(authorization, process.env.STORE_VERSION_NOTIFY_SECRET)) return true;
    const { requireOsSession } = await import("./api-auth");
    return Boolean(await requireOsSession());
  },
  async publish(app, version) {
    const { publishAppVersionUpdatedEvent } = await import("./order-realtime");
    await publishAppVersionUpdatedEvent(app, version);
  },
  realtime: () => ({ key: process.env.PUSHER_KEY || "", cluster: process.env.PUSHER_CLUSTER || "" })
});
