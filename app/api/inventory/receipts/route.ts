import { canAccessStore, requireOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import {
  readInventoryReceiptByRequest, readInventoryReceiptResponse, readInventoryReceiptSource, recordInventoryReceipt
} from "../../../../lib/inventory-receipt-data";
import { InventoryReceiptError, normalizeInventoryReceiptPayload, type InventoryReceiptPayload } from "../../../../lib/inventory-receipt-policy";
import type { EmployeeSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

function errorResponse(error: unknown) {
  if (error instanceof InventoryReceiptError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
  return Response.json({ error: "入庫内容を処理できませんでした。更新して確認してください。", code: "receipt_failed" }, { status: 503, headers: noStore });
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !await roleHasPermission(session.role, "module.inventory")) return Response.json({ error: "権限がありません。" }, { status: 403, headers: noStore });
  const params = new URL(request.url).searchParams;
  const storeId = params.get("storeId")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    return Response.json({ error: "店舗を指定してください。" }, { status: 400, headers: noStore });
  }
  if (!await canAccessStore(session, storeId)) return Response.json({ error: "この店舗の入庫を確認する権限がありません。" }, { status: 403, headers: noStore });
  try {
    const writable = await requireWritableOsSession();
    const body = await readInventoryReceiptResponse(storeId, Boolean(writable && writable.id === session.id && writable.role === session.role), params.get("orderId")?.trim() || undefined);
    if (!body) return Response.json({ error: "店舗が見つかりません。" }, { status: 404, headers: noStore });
    const canOpenOrders = await roleHasPermission(session.role, "module.orders");
    for (const source of body.sources) source.correctionHref = canOpenOrders
      ? `${session.role === "owner" || session.role === "manager" ? "/os/procurement" : "/os/orders"}?order=${encodeURIComponent(source.orderNo)}`
      : "";
    return Response.json(body, { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

function canonicalPayload(value: InventoryReceiptPayload) { return JSON.stringify(normalizeInventoryReceiptPayload(value)); }

async function replay(session: EmployeeSession, payload: InventoryReceiptPayload) {
  const existing = await readInventoryReceiptByRequest(payload.requestId);
  if (!existing) return null;
  if (!await canAccessStore(session, existing.receipt.storeId)) throw new InventoryReceiptError("この店舗の入庫を操作する権限がありません。", 403, "store_scope");
  if (canonicalPayload(existing.requestPayload) !== canonicalPayload(payload)) {
    throw new InventoryReceiptError("同じ送信IDで別の入庫内容は保存できません。元の入庫履歴を確認してください。", 409, "request_conflict");
  }
  return Response.json({ ok: true, receipt: existing.receipt, replayed: true }, { headers: noStore });
}

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session || !await roleHasPermission(session.role, "module.inventory")) return Response.json({ error: "入庫する権限がありません。" }, { status: 403, headers: noStore });
  let payload: InventoryReceiptPayload | undefined;
  try {
    payload = normalizeInventoryReceiptPayload(await request.json().catch(() => null));
    const alreadyRecorded = await replay(session, payload);
    if (alreadyRecorded) return alreadyRecorded;
    const source = await readInventoryReceiptSource(payload.purchaseOrderItemId);
    if (!source) throw new InventoryReceiptError("購入明細が見つかりません。", 404, "source_missing");
    if (!await canAccessStore(session, source.storeId)) throw new InventoryReceiptError("この店舗の入庫を操作する権限がありません。", 403, "store_scope");
    const result = await recordInventoryReceipt(session, payload, source);
    return Response.json({ ok: true, ...result }, { headers: noStore });
  } catch (error) {
    // A previous identical sender may have committed while this request waited for its lock or read stale facts.
    if (payload) {
      try { const alreadyRecorded = await replay(session, payload); if (alreadyRecorded) return alreadyRecorded; }
      catch (replayError) { return errorResponse(replayError); }
    }
    if (error && typeof error === "object" && "code" in error && error.code === "22012") {
      return errorResponse(new InventoryReceiptError("購入内容・在庫・単位の対応が更新されました。再読み込みして確認してください。", 409, "facts_changed"));
    }
    return errorResponse(error);
  }
}
