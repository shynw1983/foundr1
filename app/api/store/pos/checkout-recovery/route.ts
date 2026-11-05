import { requireOsSession } from "../../../../../lib/api-auth";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";
import { abandonUnrecordedPosCheckout } from "../../../../../lib/pos-bowl-data";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { storeId?: string; requestId?: string };
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, body.storeId);
  if (!storeId || storeId === "__forbidden__") return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!/^[a-f0-9-]{36}$/i.test(body.requestId || "")) return Response.json({ error: "会計IDが正しくありません。" }, { status: 400 });
  const abandoned = await abandonUnrecordedPosCheckout(storeId, body.requestId!, session.id);
  if (!abandoned) return Response.json({ error: "会計は既に保存されています。元の会計結果を確認してください。" }, { status: 409 });
  return Response.json({ ok: true });
}
