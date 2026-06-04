import { requireOsSession } from "../../../../lib/api-auth";
import { removeWebPushSubscription, saveWebPushSubscription } from "../../../../lib/web-push";

type SubscriptionBody = {
  subscription?: {
    endpoint?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
  endpoint?: unknown;
};

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as SubscriptionBody;
  const result = await saveWebPushSubscription(session.id, body.subscription ?? {}, request.headers.get("user-agent"));
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as SubscriptionBody;
  const endpoint = String(body.endpoint ?? body.subscription?.endpoint ?? "").trim();
  if (!endpoint) return Response.json({ error: "この端末の通知情報が見つかりません。" }, { status: 400 });
  await removeWebPushSubscription(session.id, endpoint);
  return Response.json({ ok: true });
}
