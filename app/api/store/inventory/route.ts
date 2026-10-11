import { readInventoryResponse, handleInventoryOperation } from "../../../../lib/inventory-execution-data";
import { requireStoreInventoryAccess, assertExpectedStoreInventoryOperator, assertStoreInventorySameOrigin } from "../../../../lib/store-inventory-access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  try {
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  const access = await requireStoreInventoryAccess(storeId, "read");
  if (!access.ok) return access.response;
  const response = await readInventoryResponse(access.baseSession, storeId, true);
  if (!response.ok) return response;
  const data = await response.json();
  const canOperate = Boolean(access.actor);
  return Response.json({
    selectedStoreId: storeId, locations: data.locations, recentChecks: data.recentChecks,
    canQuickCheck: canOperate, canOperate,
    items: data.items.map((item: Record<string, unknown>) => ({ ...item, canQuickCheck: canOperate }))
  }, { headers });
  } catch {
    console.error("Store inventory read failed");
    return Response.json({ error: "在庫情報を読み込めませんでした。再読み込みしてください。" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const originError = assertStoreInventorySameOrigin(request);
  if (originError) return originError;
  try {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: "入力内容を確認してください。" }, { status: 400, headers });
  const body = value as Record<string, unknown>;
  const action = String(body.action ?? "");
  const capability = action === "count" ? "count" : action === "batch_quick_check" ? "quick_check" : action === "exception" ? "exception_report" : null;
  if (!capability) return Response.json({ error: "この操作は店舗の在庫画面では行えません。" }, { status: 403, headers });
  if (capability !== "quick_check" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.itemId ?? ""))) return Response.json({ error: "在庫商品を選択してください。" }, { status: 400, headers });
  const access = await requireStoreInventoryAccess(String(body.storeId ?? ""), capability);
  if (!access.ok) return access.response;
  const conflict = assertExpectedStoreInventoryOperator(access, body.expectedOperatorId);
  if (conflict) return conflict;
  if (!access.actor) return Response.json({ error: "操作するスタッフを確認してください。" }, { status: 401, headers });
  const response = await handleInventoryOperation(access.actor, body, true);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
  } catch {
    console.error("Store inventory operation failed");
    return Response.json({ error: "在庫情報を保存できませんでした。入力内容を残して再度確認してください。" }, { status: 503, headers });
  }
}
