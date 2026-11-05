import { requireOsSession } from "../../../../../lib/api-auth";
import { getStoreOrderAccess, getScopedStoreFilter } from "../../../../../lib/store-order-access";
import { getPusher } from "../../../../../lib/order-realtime";
import { isPosDebugId, normalizePosDebugDisplayState, posDebugChannel, POS_DEBUG_DISPLAY_EVENT } from "../../../../../lib/pos-debug-display";

export const dynamic = "force-dynamic";

/** Transient broadcast only: no order, customer-display-state, usage or queue write. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "不正なリクエスト元です。" }, { status: 403 });
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 12000) return Response.json({ error: "テスト客席表示の内容が多すぎます。商品を減らしてください。" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "テスト接続を確認してください。" }, { status: 400 }); }
  if (!body || !isPosDebugId(body.storeId) || !isPosDebugId(body.sessionId)
    || !["state", "hello", "ack", "end"].includes(String(body.kind)) || !Number.isSafeInteger(body.sequence) || Number(body.sequence) < 0) {
    return Response.json({ error: "テスト接続を確認してください。" }, { status: 400 });
  }
  const access = await getStoreOrderAccess(session);
  if (getScopedStoreFilter(access, body.storeId) !== body.storeId) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const state = body.kind === "state" ? normalizePosDebugDisplayState(body.state) : undefined;
  if (body.kind === "state" && !state) return Response.json({ error: "テスト画面の内容を確認してください。" }, { status: 400 });
  const message = { storeId: body.storeId, sessionId: body.sessionId, kind: body.kind, sequence: body.sequence, ...(state ? { state } : {}) };
  if (Buffer.byteLength(JSON.stringify(message), "utf8") > 9000) return Response.json({ error: "テスト客席表示の内容が多すぎます。商品を減らしてください。" }, { status: 413 });
  const pusher = getPusher();
  if (!pusher) return Response.json({ error: "テスト客席表示に接続できません。" }, { status: 503 });
  try {
    await pusher.trigger(posDebugChannel(body.storeId, body.sessionId), POS_DEBUG_DISPLAY_EVENT, message);
  } catch {
    return Response.json({ error: "テスト客席表示への送信に失敗しました。接続を確認してください。" }, { status: 503 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
