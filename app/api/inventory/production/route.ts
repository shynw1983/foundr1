import { canAccessStore, requireOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { isHeadquarterCatalogRole } from "../../../../lib/product-catalog-policy";
import { normalizeInventoryProductionPayload, productionId, InventoryProductionError } from "../../../../lib/inventory-production-policy";
import { readInventoryProductionResponse, readProductionReplay, readProductionTransfer, recordInventoryProduction, recordInventoryTransfer } from "../../../../lib/inventory-production-data";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
function failure(error: unknown) {
  if (error instanceof InventoryProductionError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
  if (error && typeof error === "object" && "code" in error && error.code === "22012") return Response.json({ error: "製造・配送・在庫情報が更新されています。再確認してください。", code: "facts_changed" }, { status: 409, headers });
  return Response.json({ error: "製造・配送を保存できませんでした。", code: "production_failed" }, { status: 503, headers });
}
export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !await roleHasPermission(session.role, "module.inventory")) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  try {
    const storeId = productionId(new URL(request.url).searchParams.get("storeId"));
    if (!await canAccessStore(session, storeId)) throw new InventoryProductionError("この店舗を確認する権限がありません。", 403);
    const writable = await requireWritableOsSession();
    const body = await readInventoryProductionResponse(session, storeId, Boolean(writable && writable.id === session.id && writable.role === session.role));
    if (!body) throw new InventoryProductionError("店舗が見つかりません。", 404);
    return Response.json(body, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session || !await roleHasPermission(session.role, "module.inventory")) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  let payload: ReturnType<typeof normalizeInventoryProductionPayload> | undefined;
  try {
    payload = normalizeInventoryProductionPayload(await request.json().catch(() => null));
    if (payload.action === "transfer_dispatch" && !isHeadquarterCatalogRole(session.role)) throw new InventoryProductionError("配送出庫は本部担当者が登録してください。", 403);
    const replay = await readProductionReplay(session, payload);
    if (replay) {
      if (!await canAccessStore(session, replay.storeId)) throw new InventoryProductionError("この店舗を操作する権限がありません。", 403);
      return Response.json({ ok: true, ...replay }, { headers });
    }
    const stores = payload.action === "produce" ? [payload.storeId] : payload.action === "transfer_dispatch" ? [payload.sourceStoreId, payload.targetStoreId] : [];
    if (payload.action === "transfer_receive") {
      const transfer = await readProductionTransfer(payload.transferId);
      if (!transfer) throw new InventoryProductionError("配送が見つかりません。", 404);
      stores.push(String(transfer.target_store_id));
    }
    for (const storeId of stores) if (!await canAccessStore(session, storeId)) throw new InventoryProductionError("この店舗を操作する権限がありません。", 403);
    const result = payload.action === "produce" ? await recordInventoryProduction(session, payload) : await recordInventoryTransfer(session, payload);
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    if (payload && !(payload.action === "transfer_dispatch" && !isHeadquarterCatalogRole(session.role))) {
      try {
        const replay = await readProductionReplay(session, payload);
        if (replay && await canAccessStore(session, replay.storeId)) return Response.json({ ok: true, ...replay }, { headers });
      } catch (replayError) { return failure(replayError); }
    }
    return failure(error);
  }
}
