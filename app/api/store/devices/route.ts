import { requireOsSession } from "../../../../lib/api-auth";
import { getStoreOrderAccess } from "../../../../lib/store-order-access";
import { getStoreDevices, requestStoreDeviceCommand, StoreDeviceError } from "../../../../lib/store-devices";
import type { DeviceAction } from "../../../../lib/store-device-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set(["owner", "manager", "store_terminal"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function authorize(storeId: unknown) {
  const session = await requireOsSession();
  if (!session) return { error: json({ error: "ログインしてください。" }, 401) };
  if (!roles.has(session.role)) return { error: json({ error: "権限がありません。" }, 403) };
  if (typeof storeId !== "string" || !uuid.test(storeId)) return { error: json({ error: "店舗を選択してください。" }, 400) };
  const access = await getStoreOrderAccess(session);
  if (!access.stores.some(store => store.id === storeId)) return { error: json({ error: "権限がありません。" }, 403) };
  return { session, storeId };
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), access = await authorize(url.searchParams.get("storeId"));
    if (access.error) return access.error;
    const key = url.searchParams.get("device") || undefined;
    if (key && !/^[a-f0-9]{24}$/.test(key)) return json({ error: "機器を選択してください。" }, 400);
    return json(await getStoreDevices(access.storeId!, key));
  } catch (error) {
    return error instanceof StoreDeviceError ? json({ error: error.message }, error.status) : json({ error: "機器の状態を取得できません。時間をおいて更新してください。" }, 503);
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "不正なリクエスト元です。" }, 403);
  let body: { storeId?: unknown; device?: unknown; requestId?: unknown; action?: unknown; position?: unknown; confirmed?: unknown };
  try { body = await request.json(); } catch { return json({ error: "操作内容を確認してください。" }, 400); }
  if (!body || typeof body.device !== "string" || !/^[a-f0-9]{24}$/.test(body.device) || typeof body.requestId !== "string" || !uuid.test(body.requestId) || typeof body.action !== "string" || body.confirmed !== true) return json({ error: "操作内容を確認してください。" }, 400);
  if (body.action === "setPosition" && (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 0 || body.position > 100)) return json({ error: "位置は0から100で指定してください。" }, 400);
  try {
    const access = await authorize(body.storeId);
    if (access.error) return access.error;
    return json(await requestStoreDeviceCommand(access.storeId!, access.session!.id, body.device, body.requestId, body.action as DeviceAction, body.action === "setPosition" ? String(body.position) : "default"));
  } catch (error) {
    return error instanceof StoreDeviceError ? json({ error: error.message }, error.status) : json({ error: "操作結果を確認できません。再操作せず、状態を更新してください。" }, 503);
  }
}
