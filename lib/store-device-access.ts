import { requireOsSession } from "./api-auth";
import { getStoreOrderAccess } from "./store-order-access";
import { sceneUuid } from "./store-scene-state";

export const deviceJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const roles = new Set(["owner", "manager", "store_terminal"]);
export async function authorizeStoreDevices(storeId: unknown) {
  const session = await requireOsSession();
  if (!session) return { error: deviceJson({ error: "ログインしてください。" }, 401) };
  if (!roles.has(session.role)) return { error: deviceJson({ error: "権限がありません。" }, 403) };
  if (typeof storeId !== "string" || !sceneUuid.test(storeId)) return { error: deviceJson({ error: "店舗を選択してください。" }, 400) };
  const access = await getStoreOrderAccess(session);
  if (!access.stores.some(store => store.id === storeId)) return { error: deviceJson({ error: "権限がありません。" }, 403) };
  return { session, storeId };
}
