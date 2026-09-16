import { getVercelOidcToken } from "@vercel/oidc";

function getServerIdentity() {
  const provider = process.env.FCM_WIF_PROVIDER || "";
  const email = process.env.FCM_CLIENT_EMAIL || "";
  const valid = /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(provider)
    && /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email);
  return { provider, email, valid };
}

export function getOrderPushConfig() {
  const projectId = process.env.FCM_PROJECT_ID || "";
  const applicationId = process.env.FCM_ANDROID_APP_ID || "";
  const apiKey = process.env.FCM_ANDROID_API_KEY || "";
  const senderId = process.env.FCM_SENDER_ID || "";
  const fcm = Boolean(projectId && applicationId && apiKey && senderId && getServerIdentity().valid);
  return {
    enabled: process.env.STORE_ORDER_PUSH_ENABLED === "true",
    fcm,
    firebase: fcm ? { projectId, applicationId, apiKey, senderId } : null,
  };
}

let accessToken: { value: string; expiresAt: number } | null = null;
let pendingAccessToken: Promise<string> | null = null;

async function exchangeFcmAccessToken() {
  const identity = getServerIdentity();
  if (!identity.valid) throw new OrderPushTransportError("FCM_NOT_CONFIGURED");
  let subjectToken: string;
  try {
    // Read at dispatch time so workflow steps and cron requests use their current runtime identity.
    subjectToken = await getVercelOidcToken();
  } catch {
    throw new OrderPushTransportError("FCM_OIDC_UNAVAILABLE");
  }
  const exchange = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${identity.provider}`,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: subjectToken,
      scope: "https://www.googleapis.com/auth/cloud-platform"
    }),
    signal: AbortSignal.timeout(8000)
  });
  const federated = await exchange.json();
  if (!exchange.ok || !federated.access_token) throw new OrderPushTransportError(`FCM_STS_${exchange.status}`);
  const response = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(identity.email)}:generateAccessToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${federated.access_token}`, "Content-Type": "application/json" },
    // The federated principal can impersonate only the dedicated send-only service account.
    body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/firebase.messaging"], lifetime: "900s" }),
    signal: AbortSignal.timeout(8000)
  });
  const body = await response.json();
  const expiresAt = Date.parse(body.expireTime);
  if (!response.ok || !body.accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    throw new OrderPushTransportError(`FCM_AUTH_${response.status}`);
  }
  accessToken = { value: body.accessToken, expiresAt };
  return accessToken.value;
}

async function getFcmAccessToken() {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  if (!pendingAccessToken) pendingAccessToken = exchangeFcmAccessToken();
  try { return await pendingAccessToken; }
  finally { pendingAccessToken = null; }
}

export type OrderPushDevice = {
  id: string; employeeId: string; sessionId: string; provider: "fcm";
  registration: { token?: string };
  language: string;
};

export class OrderPushTransportError extends Error {
  constructor(message: string, public expired = false) { super(message); }
}

async function sendFcmMessage(message: object, validateOnly = false) {
  if (!getOrderPushConfig().fcm) throw new OrderPushTransportError("FCM_NOT_CONFIGURED");
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(process.env.FCM_PROJECT_ID!)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getFcmAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(validateOnly ? { validate_only: true } : {}) }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const expired = body.error?.details?.some((detail: { errorCode?: string }) => detail.errorCode === "UNREGISTERED") === true;
    if (response.status === 401) accessToken = null;
    throw new OrderPushTransportError(`FCM_SEND_${response.status}`, expired);
  }
}

// Deployment check: Firebase validates authorization and payload without delivering a message.
export async function verifyOrderPushTransport() {
  await sendFcmMessage({
    topic: "foundr1-store-transport-validation",
    data: { type: "store_push_transport_validation" },
    android: { priority: "high", ttl: "60s", restricted_package_name: "jp.foundr1.store" }
  }, true);
}

export async function sendOrderPush(device: OrderPushDevice, payload: Record<string, string>) {
  const config = getOrderPushConfig();
  if (device.provider === "fcm") {
    if (!config.fcm || !device.registration.token) throw new OrderPushTransportError("FCM_NOT_CONFIGURED");
    await sendFcmMessage({
      token: device.registration.token,
      // The native receiver checks the local geofence before displaying. No automatic notification payload.
      data: { ...payload, sessionId: device.sessionId },
      android: { priority: "high", ttl: "60s", restricted_package_name: "jp.foundr1.store" }
    });
    return;
  }
  throw new OrderPushTransportError("UNSUPPORTED_PROVIDER");
}
