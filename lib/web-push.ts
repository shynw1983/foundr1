import webPush from "web-push";
import { sql } from "./db";
import { publishOsNotificationEvent } from "./notification-realtime";

type PushSubscriptionInput = {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

type NotificationPayload = {
  title: string;
  message: string;
  href?: string | null;
  type?: string;
};

let configured = false;

function getVapidConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "";
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:admin@foundr1.jp";
  return {
    enabled: Boolean(publicKey && privateKey),
    publicKey,
    privateKey,
    subject
  };
}

function configureWebPush() {
  const config = getVapidConfig();
  if (!config.enabled) return config;
  if (!configured) {
    webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configured = true;
  }
  return config;
}

export function getWebPushPublicConfig() {
  const config = getVapidConfig();
  return {
    enabled: config.enabled,
    publicKey: config.publicKey
  };
}

export function parsePushSubscription(input: PushSubscriptionInput) {
  const endpoint = String(input.endpoint ?? "").trim();
  const p256dh = String(input.keys?.p256dh ?? "").trim();
  const auth = String(input.keys?.auth ?? "").trim();
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export async function saveWebPushSubscription(employeeId: string, subscription: PushSubscriptionInput, userAgent: string | null) {
  const parsed = parsePushSubscription(subscription);
  if (!parsed) {
    return { ok: false, error: "この端末の通知情報を保存できませんでした。" };
  }
  await sql`
    insert into web_push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent, revoked_at, updated_at)
    values (${employeeId}, ${parsed.endpoint}, ${parsed.p256dh}, ${parsed.auth}, ${userAgent}, null, now())
    on conflict (endpoint)
    do update set
      employee_id = excluded.employee_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      revoked_at = null,
      last_error = null,
      updated_at = now()
  `;
  return { ok: true };
}

export async function removeWebPushSubscription(employeeId: string, endpoint: string) {
  await sql`
    update web_push_subscriptions
    set revoked_at = now(), updated_at = now()
    where employee_id = ${employeeId}
      and endpoint = ${endpoint}
  `;
}

export async function sendWebPushToEmployee(employeeId: string, payload: NotificationPayload) {
  const config = configureWebPush();
  if (!config.enabled) return { sent: 0, skipped: true };

  const subscriptions = await sql`
    select id::text, endpoint, p256dh, auth
    from web_push_subscriptions
    where employee_id = ${employeeId}
      and revoked_at is null
    order by updated_at desc
  `;

  let sent = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    const webPushSubscription = {
      endpoint: String(subscription.endpoint),
      keys: {
        p256dh: String(subscription.p256dh),
        auth: String(subscription.auth)
      }
    };
    try {
      await webPush.sendNotification(webPushSubscription, JSON.stringify({
        title: payload.title,
        body: payload.message,
        href: payload.href || "/os",
        type: payload.type || "foundr1_notification",
        sentAt: new Date().toISOString()
      }));
      sent += 1;
      await sql`
        update web_push_subscriptions
        set last_success_at = now(), last_error = null, updated_at = now()
        where id::text = ${String(subscription.id)}
      `;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : null;
      const message = error instanceof Error ? error.message : "Web Push failed";
      await sql`
        update web_push_subscriptions
        set
          last_error = ${message},
          revoked_at = case when ${statusCode} in (404, 410) then now() else revoked_at end,
          updated_at = now()
        where id::text = ${String(subscription.id)}
      `;
    }
  }));

  return { sent, skipped: false };
}

export async function createOsNotification(input: {
  employeeId: string;
  type: string;
  title: string;
  message: string;
  href: string;
  sendPush?: boolean;
}) {
  await sql`
    insert into os_notifications (recipient_employee_id, notification_type, title, message, href)
    values (${input.employeeId}, ${input.type}, ${input.title}, ${input.message}, ${input.href})
  `;
  await publishOsNotificationEvent(input.employeeId).catch(() => undefined);
  if (input.sendPush === false) return;
  await sendWebPushToEmployee(input.employeeId, {
    title: input.title,
    message: input.message,
    href: input.href,
    type: input.type
  });
}
