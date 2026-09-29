import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cameraCaptureDeadlineMs, cameraTicketLifetimeMs, cameraUuid, type CameraTicket } from "./store-camera-state";

export function createCameraSigner(secret: string, now = () => Date.now()) {
  if (secret.length < 32) throw new Error("camera_secret_missing");
  const sign = (payload: string) => createHmac("sha256", secret).update(`foundr1-camera-v1:${payload}`).digest("base64url");
  return {
    issue(input: Pick<CameraTicket, "storeId" | "cameraId" | "bridgeDeviceId" | "actorId" | "sessionId">) {
      const issuedAt = now();
      const ticket: CameraTicket = { ...input, v: 1, requestId: randomUUID(), issuedAt, expiresAt: issuedAt + cameraTicketLifetimeMs };
      const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
      return { token: `${payload}.${sign(payload)}`, ticket };
    },
    read(token: unknown, capture = false): CameraTicket | null {
      if (typeof token !== "string" || token.length > 2048) return null;
      const parts = token.split(".");
      if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
      const expected = Buffer.from(sign(parts[0])), actual = Buffer.from(parts[1]);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      try {
        const t = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as CameraTicket;
        if (t.v !== 1 || ![t.requestId, t.storeId, t.bridgeDeviceId, t.actorId, t.sessionId].every(s => typeof s === "string" && cameraUuid.test(s))
          || typeof t.cameraId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(t.cameraId)
          || !Number.isSafeInteger(t.issuedAt) || !Number.isSafeInteger(t.expiresAt)
          || t.expiresAt - t.issuedAt !== cameraTicketLifetimeMs || t.issuedAt > now() + 5000
          || now() >= t.expiresAt || (capture && now() >= t.issuedAt + cameraCaptureDeadlineMs)) return null;
        return t;
      } catch { return null; }
    },
  };
}

export const cameraBridgeChannel = (deviceId: string) => `private-store-camera-bridge-${deviceId}`;
export const cameraViewerChannel = (id: string) => `private-store-camera-view-${id}`;
export const cameraBlobPrefix = (bridgeDeviceId: string, storeId: string) => `store-cameras/${bridgeDeviceId}/${storeId}/`;
export const cameraBlobPath = (ticket: CameraTicket) => `${cameraBlobPrefix(ticket.bridgeDeviceId, ticket.storeId)}${ticket.requestId}.mp4`;
