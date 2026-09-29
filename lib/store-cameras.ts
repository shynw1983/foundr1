import { del, get, list, put } from "@vercel/blob";
import { requireOsSession } from "./api-auth";
import { getStoreOrderAccess } from "./store-order-access";
import { authorizeLocalBridge } from "./local-bridge-auth";
import { getPusher } from "./order-realtime";
import { cameraMaxBytes, cameraRoles, cameraUuid } from "./store-camera-state";
import { CameraRequestError, createCameraHandlers, type CameraConfig } from "./store-camera-handlers";
import { createCameraSigner } from "./store-camera-ticket";

function config(): CameraConfig[] {
  const raw = process.env.STORE_CAMERAS_JSON;
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 100) throw new Error("camera_config_invalid");
  const seen = new Set<string>();
  return value.map(c => {
    if (!c || !cameraUuid.test(c.storeId) || !cameraUuid.test(c.bridgeDeviceId)
      || typeof c.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(c.id)
      || typeof c.name !== "string" || !c.name.trim() || c.name.length > 100
      || !["desktop", "uber_eats", "rocket_now", "demae_can"].includes(c.bridgePlatform)
      || seen.has(`${c.storeId}:${c.id}`)) throw new Error("camera_config_invalid");
    seen.add(`${c.storeId}:${c.id}`);
    return { storeId: c.storeId, bridgeDeviceId: c.bridgeDeviceId, bridgePlatform: c.bridgePlatform, id: c.id, name: c.name, model: "SoloCam S340" };
  });
}
function blobToken() {
  const token = process.env.CAMERA_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("private_camera_storage_missing");
  return token;
}
function pusher() {
  const client = getPusher();
  if (!client) throw new Error("camera_realtime_missing");
  return client;
}
export const storeCameraHandlers = createCameraHandlers({
  cameras: config,
  signer: () => createCameraSigner(process.env.STORE_CAMERA_SECRET || process.env.AUTH_SECRET || ""),
  async authorizeStore(storeId) {
    const session = await requireOsSession();
    if (!session) throw new CameraRequestError(401, "ログインしてください。");
    if (!cameraRoles.has(session.role)) throw new CameraRequestError(403, "権限がありません。");
    if (!cameraUuid.test(storeId)) throw new CameraRequestError(400, "店舗を選択してください。");
    const access = await getStoreOrderAccess(session);
    if (!session.sessionId || !access.stores.some(s => s.id === storeId)) throw new CameraRequestError(403, "権限がありません。");
    return { id: session.id, sessionId: session.sessionId };
  },
  async authorizeBridge(request, storeId) {
    if (!cameraUuid.test(storeId) || !/^Bearer \S+$/i.test(request.headers.get("authorization") || "")) throw new CameraRequestError(401, "Unauthorized bridge.");
    const cameras = config().filter(c => c.storeId === storeId);
    for (const platform of new Set(cameras.map(c => c.bridgePlatform))) {
      const auth = await authorizeLocalBridge(request, storeId, platform);
      // A real enrolled device is required; neither development bypass nor a shared master token can view cameras.
      if (auth.authorized && auth.deviceId && cameras.some(c => c.bridgeDeviceId === auth.deviceId)) return auth.deviceId;
    }
    throw new CameraRequestError(403, "Unauthorized bridge.");
  },
  realtime() {
    pusher(); blobToken();
    return { key: process.env.PUSHER_KEY!, cluster: process.env.PUSHER_CLUSTER! };
  },
  channelAuth: (socket, channel) => pusher().authorizeChannel(socket, channel),
  publish: (channel, event, data) => pusher().trigger(channel, event, data),
  async putClip(path, bytes) {
    await put(path, Buffer.from(bytes), { access: "private", token: blobToken(), addRandomSuffix: false, allowOverwrite: false, contentType: "video/mp4", cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(20_000) });
  },
  async getClip(path) {
    const result = await get(path, { access: "private", token: blobToken(), useCache: false, abortSignal: AbortSignal.timeout(20_000) });
    if (!result || result.statusCode !== 200) return null;
    if (result.blob.size > cameraMaxBytes) { await result.stream.cancel(); throw new Error("camera_clip_too_large"); }
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  },
  deleteClip: path => del(path, { token: blobToken(), abortSignal: AbortSignal.timeout(15_000) }),
  async cleanExpired(prefix) {
    // Called at Bridge startup and after a capture. No cron, idle database polling or global media scan.
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await list({ prefix, cursor, limit: 100, token: blobToken(), abortSignal: AbortSignal.timeout(15_000) });
      const expired = result.blobs.filter(b => Date.now() - b.uploadedAt.getTime() > 5 * 60_000).map(b => b.url);
      if (expired.length) await del(expired, { token: blobToken(), abortSignal: AbortSignal.timeout(15_000) });
      if (!result.hasMore) break;
      cursor = result.cursor;
    }
  },
});
