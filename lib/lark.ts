type LarkSendResult =
  | { ok: true; delivered: boolean; channel: "direct" | "webhook" | "none"; error?: never }
  | { ok: false; delivered: false; channel: "direct" | "webhook"; error: string };

type LarkRecipient = {
  larkOpenId?: string | null;
  larkUserId?: string | null;
};

type PurchaseOrderLarkMessage = {
  orderNo: string;
  storeName: string;
  itemCount: number;
  deadline?: string | null;
  buyerName?: string | null;
  href: string;
};

let cachedTenantToken: { value: string; expiresAt: number } | null = null;
const larkRequestTimeoutMs = 4_000;

async function fetchLark(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), larkRequestTimeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    "";
}

function getAbsoluteHref(href: string) {
  if (/^https?:\/\//.test(href)) return href;
  const appUrl = getAppUrl().replace(/\/$/, "");
  return appUrl ? `${appUrl}${href.startsWith("/") ? href : `/${href}`}` : href;
}

function buildPurchaseOrderText(message: PurchaseOrderLarkMessage) {
  return [
    "新しい発注依頼があります",
    `依頼番号：${message.orderNo}`,
    `店舗：${message.storeName}`,
    `商品：${message.itemCount} 件`,
    message.deadline ? `締切：${message.deadline}` : "",
    message.buyerName ? `購入担当：${message.buyerName}` : "",
    `確認する：${getAbsoluteHref(message.href)}`
  ].filter(Boolean).join("\n");
}

async function getTenantAccessToken() {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) return null;

  if (cachedTenantToken && cachedTenantToken.expiresAt > Date.now() + 60_000) {
    return cachedTenantToken.value;
  }

  const response = await fetchLark("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const body = await response.json().catch(() => ({})) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(body.msg || `Lark token request failed: ${response.status}`);
  }

  cachedTenantToken = {
    value: body.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expire ?? 7200) - 120) * 1000
  };
  return cachedTenantToken.value;
}

async function sendDirectText(recipient: LarkRecipient, text: string): Promise<LarkSendResult> {
  const receiveId = recipient.larkOpenId || recipient.larkUserId;
  if (!receiveId) return { ok: true, delivered: false, channel: "none" };

  const token = await getTenantAccessToken();
  if (!token) return { ok: true, delivered: false, channel: "none" };

  const receiveIdType = recipient.larkOpenId ? "open_id" : "user_id";
  const response = await fetchLark(`https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: "text",
      content: JSON.stringify({ text })
    })
  });
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };

  if (!response.ok || body.code !== 0) {
    return { ok: false, delivered: false, channel: "direct", error: body.msg || `Lark message failed: ${response.status}` };
  }

  return { ok: true, delivered: true, channel: "direct" };
}

async function sendWebhookText(text: string): Promise<LarkSendResult> {
  const webhookUrl = process.env.LARK_WEBHOOK_URL;
  if (!webhookUrl) return { ok: true, delivered: false, channel: "none" };

  const response = await fetchLark(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      msg_type: "text",
      content: { text }
    })
  });
  const body = await response.json().catch(() => ({})) as { code?: number; StatusCode?: number; msg?: string; StatusMessage?: string };
  const okCode = body.code === 0 || body.StatusCode === 0;

  if (!response.ok || !okCode) {
    return {
      ok: false,
      delivered: false,
      channel: "webhook",
      error: body.msg || body.StatusMessage || `Lark webhook failed: ${response.status}`
    };
  }

  return { ok: true, delivered: true, channel: "webhook" };
}

export async function sendPurchaseOrderLarkNotification(
  recipient: LarkRecipient,
  message: PurchaseOrderLarkMessage
): Promise<LarkSendResult> {
  if (process.env.LARK_ENABLED === "false") {
    return { ok: true, delivered: false, channel: "none" };
  }

  const text = buildPurchaseOrderText(message);
  try {
    const directResult = await sendDirectText(recipient, text);
    if (directResult.delivered || directResult.ok === false || !process.env.LARK_WEBHOOK_URL) {
      return directResult;
    }
    return await sendWebhookText(text);
  } catch (error) {
    return {
      ok: false,
      delivered: false,
      channel: "direct",
      error: error instanceof Error ? error.message : "Lark notification failed"
    };
  }
}
