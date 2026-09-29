import { cameraCaptureDeadlineMs, cameraErrors, cameraMaxBytes, cameraUuid, type CameraTicket, type StoreCamera } from "./store-camera-state";
import { cameraBlobPath, cameraBlobPrefix, cameraBridgeChannel, cameraViewerChannel, createCameraSigner } from "./store-camera-ticket";

export type CameraConfig = StoreCamera & { storeId: string; bridgeDeviceId: string; bridgePlatform: string };
type Actor = { id: string; sessionId: string };
type Dependencies = {
  cameras: () => CameraConfig[];
  signer: () => ReturnType<typeof createCameraSigner>;
  authorizeStore: (storeId: string) => Promise<Actor>;
  authorizeBridge: (request: Request, storeId: string) => Promise<string>;
  realtime: () => { key: string; cluster: string };
  channelAuth: (socket: string, channel: string) => unknown;
  publish: (channel: string, event: string, data: Record<string, unknown>) => Promise<unknown>;
  putClip: (path: string, bytes: Uint8Array) => Promise<void>;
  getClip: (path: string) => Promise<Uint8Array | null>;
  deleteClip: (path: string) => Promise<void>;
  cleanExpired: (prefix: string) => Promise<void>;
};
export class CameraRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const errorResponse = (error: unknown) => error instanceof CameraRequestError ? json({ error: error.message }, error.status) : json({ error: cameraErrors.unavailable }, 503);
const fail = (status: number, message: string): never => { throw new CameraRequestError(status, message); };
function originCheck(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || origin && origin !== new URL(request.url).origin) fail(403, "不正なリクエスト元です。");
}
async function bytes(request: Request, max: number) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > max) fail(413, cameraErrors.too_large);
  if (!request.body) fail(400, "操作内容を確認してください。");
  const reader = request.body!.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); fail(413, cameraErrors.too_large); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail(415, "操作内容を確認してください。");
  const raw = await bytes(request, 8192);
  try { const body = JSON.parse(raw.toString()); if (body && typeof body === "object" && !Array.isArray(body)) return body; } catch {}
  return fail(400, "操作内容を確認してください。");
}
const socketValid = (s: unknown): s is string => typeof s === "string" && /^\d+\.\d+$/.test(s) && s.length < 100;

export function createCameraHandlers(deps: Dependencies) {
  function configured(t: Pick<CameraTicket, "storeId" | "cameraId" | "bridgeDeviceId">) {
    return deps.cameras().some(c => c.storeId === t.storeId && c.id === t.cameraId && c.bridgeDeviceId === t.bridgeDeviceId);
  }
  function ticket(token: unknown, capture = false) {
    const t = deps.signer().read(token, capture);
    if (!t || !configured(t)) return fail(410, cameraErrors.expired);
    return t;
  }
  async function viewer(body: Record<string, unknown>, capture = false) {
    const t = ticket(body.ticket, capture), actor = await deps.authorizeStore(t.storeId);
    if (actor.id !== t.actorId || actor.sessionId !== t.sessionId) fail(403, "権限がありません。");
    return t;
  }
  async function bridge(request: Request, t: CameraTicket) {
    if (await deps.authorizeBridge(request, t.storeId) !== t.bridgeDeviceId) fail(403, "権限がありません。");
  }
  return {
    async storeGet(request: Request) {
      try {
        const storeId = new URL(request.url).searchParams.get("storeId") || "";
        await deps.authorizeStore(storeId);
        return json({ cameras: deps.cameras().filter(c => c.storeId === storeId).map(({ id, name, model }) => ({ id, name, model })) });
      } catch (error) { return errorResponse(error); }
    },
    async storePost(request: Request) {
      try {
        originCheck(request);
        const body = await bodyJson(request);
        if (body.action === "prepare") {
          const storeId = typeof body.storeId === "string" ? body.storeId : "", actor = await deps.authorizeStore(storeId);
          const camera = deps.cameras().find(c => c.storeId === storeId && c.id === body.cameraId);
          if (!camera) fail(404, "この店舗のカメラが見つかりません。");
          const { token, ticket: t } = deps.signer().issue({ storeId, cameraId: camera!.id, bridgeDeviceId: camera!.bridgeDeviceId, actorId: actor.id, sessionId: actor.sessionId });
          return json({ ticket: token, requestId: t.requestId, channel: cameraViewerChannel(t.requestId), captureDeadline: t.issuedAt + cameraCaptureDeadlineMs, ...deps.realtime() });
        }
        const t = await viewer(body, body.action === "capture");
        if (body.action === "realtime") {
          if (!socketValid(body.socket_id) || body.channel_name !== cameraViewerChannel(t.requestId)) fail(403, "権限がありません。");
          return json(deps.channelAuth(body.socket_id as string, cameraViewerChannel(t.requestId)));
        }
        if (body.action === "capture") {
          await deps.publish(cameraBridgeChannel(t.bridgeDeviceId), "camera.capture", { ticket: body.ticket, requestId: t.requestId, cameraId: t.cameraId, storeId: t.storeId, deadline: t.issuedAt + cameraCaptureDeadlineMs });
          return json({ accepted: true });
        }
        if (body.action === "cancel") {
          await Promise.allSettled([
            deps.publish(cameraBridgeChannel(t.bridgeDeviceId), "camera.cancel", { requestId: t.requestId, cameraId: t.cameraId }),
            deps.deleteClip(cameraBlobPath(t)),
          ]);
          return json({ stopped: true });
        }
        if (body.action === "media") {
          const clip = await deps.getClip(cameraBlobPath(t));
          if (!clip) fail(410, cameraErrors.expired);
          if (clip!.byteLength > cameraMaxBytes) fail(413, cameraErrors.too_large);
          // The browser owns a memory-only copy; the cloud copy is no longer needed.
          await deps.deleteClip(cameraBlobPath(t));
          return new Response(new Uint8Array(clip!), { headers: { ...headers, "Content-Type": "video/mp4", "Content-Length": String(clip!.byteLength) } });
        }
        return fail(400, "操作内容を確認してください。");
      } catch (error) { return errorResponse(error); }
    },
    async bridgeGet(request: Request) {
      try {
        const storeId = new URL(request.url).searchParams.get("storeId") || "", deviceId = await deps.authorizeBridge(request, storeId);
        if (!cameraUuid.test(deviceId)) fail(403, "権限がありません。");
        const cameras = deps.cameras().filter(c => c.storeId === storeId && c.bridgeDeviceId === deviceId).map(({ id, name, model }) => ({ id, name, model }));
        if (!cameras.length) fail(403, "権限がありません。");
        return json({ ...deps.realtime(), channel: cameraBridgeChannel(deviceId), cameras });
      } catch (error) { return errorResponse(error); }
    },
    async bridgePost(request: Request) {
      try {
        if (request.headers.get("x-camera-action") === "upload") {
          const t = ticket(request.headers.get("x-camera-ticket"), true);
          await bridge(request, t);
          if (request.headers.get("content-type") !== "video/mp4") fail(415, "操作内容を確認してください。");
          const capturedAt = request.headers.get("x-camera-captured-at") || "", capturedTime = Date.parse(capturedAt);
          if (!Number.isFinite(capturedTime) || capturedTime < t.issuedAt - 5000 || capturedTime > Date.now() + 5000) fail(400, "操作内容を確認してください。");
          const clip = await bytes(request, cameraMaxBytes);
          if (clip.length < 24 || clip.toString("ascii", 4, 8) !== "ftyp") fail(400, "映像を読み取れませんでした。");
          await deps.putClip(cameraBlobPath(t), clip);
          try { await deps.publish(cameraViewerChannel(t.requestId), "camera.ready", { requestId: t.requestId, capturedAt, bytes: clip.length }); }
          catch (error) { await deps.deleteClip(cameraBlobPath(t)).catch(() => {}); throw error; }
          return json({ received: true });
        }
        const body = await bodyJson(request);
        if (body.action === "realtime" || body.action === "cleanup") {
          const storeId = typeof body.storeId === "string" ? body.storeId : "", deviceId = await deps.authorizeBridge(request, storeId);
          if (!deps.cameras().some(c => c.storeId === storeId && c.bridgeDeviceId === deviceId)) fail(403, "権限がありません。");
          if (body.action === "cleanup") { await deps.cleanExpired(cameraBlobPrefix(deviceId, storeId)); return json({ cleaned: true }); }
          if (!socketValid(body.socket_id) || body.channel_name !== cameraBridgeChannel(deviceId)) fail(403, "権限がありません。");
          return json(deps.channelAuth(body.socket_id as string, cameraBridgeChannel(deviceId)));
        }
        const t = ticket(body.ticket);
        await bridge(request, t);
        if (body.action === "failure") {
          const code = typeof body.code === "string" && ["unavailable", "busy", "login_required", "timeout", "too_large", "cancelled"].includes(body.code) ? body.code : "unavailable";
          await deps.publish(cameraViewerChannel(t.requestId), "camera.failed", { requestId: t.requestId, code });
          return json({ received: true });
        }
        if (body.action === "delete") { await deps.deleteClip(cameraBlobPath(t)); return json({ deleted: true }); }
        return fail(400, "操作内容を確認してください.");
      } catch (error) { return errorResponse(error); }
    },
  };
}
