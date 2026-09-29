import { requireOsSession } from "../../../../lib/api-auth";
import { getStoreOrderAccess } from "../../../../lib/store-order-access";
import { getIndoorLight, requestIndoorLightPress, IndoorLightError } from "../../../../lib/store-indoor-light";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storeRoles = new Set(["owner", "manager", "store_terminal"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function authorized(storeId: unknown) {
  const session = await requireOsSession();
  if (!session) return { error: json({ error: "ログインしてください。" }, 401) };
  if (!storeRoles.has(session.role)) return { error: json({ error: "権限がありません。" }, 403) };
  if (typeof storeId !== "string" || !uuid.test(storeId)) return { error: json({ error: "店舗を選択してください。" }, 400) };
  const access = await getStoreOrderAccess(session);
  if (!access.stores.some(store => store.id === storeId)) return { error: json({ error: "権限がありません。" }, 403) };
  return { session, storeId };
}

export async function GET(request: Request) {
  try {
    const access = await authorized(new URL(request.url).searchParams.get("storeId"));
    if (access.error) return access.error;
    return json(await getIndoorLight(access.storeId!));
  } catch {
    return json({ error: "照明の状態を取得できません。時間をおいて更新してください。" }, 503);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "不正なリクエスト元です。" }, 403);
  let body: { storeId?: unknown; requestId?: unknown; action?: unknown };
  try { body = await request.json(); } catch { return json({ error: "操作内容を確認してください。" }, 400); }
  if (!body || body.action !== "press" || typeof body.requestId !== "string" || !uuid.test(body.requestId)) return json({ error: "操作内容を確認してください。" }, 400);
  try {
    const access = await authorized(body.storeId);
    if (access.error) return access.error;
    return json({ command: await requestIndoorLightPress(access.storeId!, access.session!.id, body.requestId) });
  } catch (error) {
    if (error instanceof IndoorLightError) return json({ error: error.message }, error.status);
    return json({ error: "操作結果を確認できません。再操作せず、状態を更新してください。" }, 503);
  }
}
