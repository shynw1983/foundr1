import { assertExpectedStoreInventoryOperator, assertStoreInventorySameOrigin, requireStoreInventoryAccess } from "../../../../../lib/store-inventory-access";
import {
  readInventoryReceiptByRequest, readInventoryReceiptResponse, readInventoryReceiptSource,
  readInventoryReceiptStoreConfirmation, recordInventoryReceipt
} from "../../../../../lib/inventory-receipt-data";
import {
  InventoryReceiptError, normalizeInventoryReceiptPayload, type InventoryReceiptPayload
} from "../../../../../lib/inventory-receipt-policy";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

function errorResponse(error: unknown) {
  if (error instanceof InventoryReceiptError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
  if (error && typeof error === "object" && "code" in error && error.code === "22012") {
    return Response.json({ error: "購入内容・在庫・単位の対応が更新されました。再読み込みして確認してください。", code: "facts_changed" }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "入庫内容を処理できませんでした。更新して確認してください。", code: "receipt_failed" }, { status: 503, headers: noStore });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const access = await requireStoreInventoryAccess(params.get("storeId") ?? "", "read");
  if (!access.ok) return access.response;
  try {
    const body = await readInventoryReceiptResponse(access.storeId, Boolean(access.actor), params.get("orderId")?.trim() || undefined);
    if (!body) return Response.json({ error: "店舗が見つかりません。" }, { status: 404, headers: noStore });
    for (const source of body.sources) source.correctionHref = "";
    return Response.json(body, { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

const canonicalPayload = (value: InventoryReceiptPayload) => JSON.stringify(normalizeInventoryReceiptPayload(value));

async function replay(payload: InventoryReceiptPayload, storeId: string) {
  const existing = await readInventoryReceiptByRequest(payload.requestId);
  if (!existing) return null;
  if (existing.receipt.storeId !== storeId) throw new InventoryReceiptError("この店舗の入庫を操作する権限がありません。", 403, "store_scope");
  if (canonicalPayload(existing.requestPayload) !== canonicalPayload(payload)) {
    throw new InventoryReceiptError("同じ送信IDで別の入庫内容は保存できません。元の入庫履歴を確認してください。", 409, "request_conflict");
  }
  return Response.json({ ok: true, receipt: existing.receipt, replayed: true,
    storeConfirmation: await readInventoryReceiptStoreConfirmation(existing.receipt.purchaseOrderItemId) }, { headers: noStore });
}

export async function POST(request: Request) {
  const originFailure=assertStoreInventorySameOrigin(request);
  if(originFailure)return originFailure;
  const body = await request.json().catch(() => null);
  const access = await requireStoreInventoryAccess(String(body?.expectedSource?.storeId ?? ""), "receipt");
  if (!access.ok) return access.response;
  if (!access.actor) return Response.json({ error: "操作する従業員を確認してください。", code: "operator_required" }, { status: 401, headers: noStore });
  const operatorFailure = assertExpectedStoreInventoryOperator(access, body?.expectedOperatorId);
  if (operatorFailure) return operatorFailure;
  let payload: InventoryReceiptPayload | undefined;
  try {
    payload = normalizeInventoryReceiptPayload(body);
    if (!payload.confirmStoreReceiving) throw new InventoryReceiptError("店舗での入庫と確認の登録方法を確認してください。", 400, "store_confirmation_required");
    if (payload.expectedSource.storeId !== access.storeId) throw new InventoryReceiptError("この店舗の入庫を操作する権限がありません。", 403, "store_scope");
    const previous = await replay(payload, access.storeId);
    if (previous) return previous;
    const source = await readInventoryReceiptSource(payload.purchaseOrderItemId);
    if (!source) throw new InventoryReceiptError("購入明細が見つかりません。", 404, "source_missing");
    if (source.storeId !== access.storeId) throw new InventoryReceiptError("この店舗の入庫を操作する権限がありません。", 403, "store_scope");
    const result = await recordInventoryReceipt(access.actor, payload, source, access.baseSession.role === "store_terminal"
      ? { terminalEmployeeId: access.baseSession.id } : undefined);
    return Response.json({ ok: true, ...result,
      storeConfirmation: await readInventoryReceiptStoreConfirmation(source.purchaseOrderItemId) }, { headers: noStore });
  } catch (error) {
    if (payload) {
      try { const previous = await replay(payload, access.storeId); if (previous) return previous; }
      catch (replayError) { return errorResponse(replayError); }
    }
    return errorResponse(error);
  }
}
