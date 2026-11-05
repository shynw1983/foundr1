import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { findCustomerOrderById } from "../../../../../lib/customer-orders";
import { mutatePosFulfillment, readPosFulfillmentTasks } from "../../../../../lib/pos-fulfillment";
import type { PosFulfillmentAction } from "../../../../../lib/pos-fulfillment-policy";
import { normalizePosFulfillmentWorkspaceSettings } from "../../../../../lib/pos-fulfillment-settings";
import { requirePosOperatorForWrite, validatePosOperatorStore } from "../../../../../lib/pos-operator-access";
import { assertPosOperatorSameOrigin, posOperatorDatabaseFailure } from "../../../../../lib/pos-operator-credentials";
import { posOperatorUuid } from "../../../../../lib/pos-operator-policy";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";
import { syncWebReservationToSalesOrder } from "../../../../../lib/sales-orders";
import { syncDiningSessionFromProduction } from "../../../../../lib/store-dining-sessions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

async function readSettings(storeId: string) {
  const rows = await sql`select printer_settings->'fulfillmentWorkspace' as settings from pos_store_settings where store_id::text=${storeId}`;
  return normalizePosFulfillmentWorkspaceSettings(rows[0]?.settings);
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401, headers });
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!posOperatorUuid.test(storeId)) return Response.json({ error: "店舗を確認してください。" }, { status: 400, headers });
  const denied = await validatePosOperatorStore(session, storeId);
  if (denied) return denied.response;
  const settings = await readSettings(storeId);
  return Response.json({ selectedStoreId: storeId, settings, tasks: settings.enabled ? await readPosFulfillmentTasks(storeId) : [], serverNow: new Date().toISOString() }, { headers });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401, headers });
  const originFailure = assertPosOperatorSameOrigin(request);
  if (originFailure) return originFailure;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const storeId = typeof body?.storeId === "string" ? body.storeId.trim() : "";
  const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
  const mutationId = typeof body?.mutationId === "string" ? body.mutationId.trim() : "";
  const expectedVersion = typeof body?.expectedVersion === "string" ? body.expectedVersion : "";
  const undoToken = typeof body?.undoToken === "string" ? body.undoToken : "";
  const action = String(body?.action ?? "");
  if (!posOperatorUuid.test(storeId) || !posOperatorUuid.test(taskId) || !posOperatorUuid.test(mutationId)
    || !/^[0-9a-f]{32}$/.test(expectedVersion) || !["ready", "handoff", "recall", "undo"].includes(action)
    || (action === "undo" && !posOperatorUuid.test(undoToken))) {
    return Response.json({ error: "更新内容が不正です。" }, { status: 400, headers });
  }
  const operator = await requirePosOperatorForWrite(session, storeId, body, "checkout", false);
  if (!operator.ok) return operator.response;
  const settings = await readSettings(storeId);
  if (!settings.enabled) return Response.json({ error: "この店舗の提供管理は無効です。" }, { status: 409, headers });
  try {
    const result = await mutatePosFulfillment({ storeId, taskId, mutationId, expectedVersion, undoToken,
      action: action as PosFulfillmentAction, actorId: operator.actor.id, baseSessionId: session.sessionId ?? "",
      writeGuards: operator.writeGuards });
    if (!result) return Response.json({ error: "料理の状態が変わりました。最新の表示を確認してください。", code: "fulfillment_conflict" }, { status: 409, headers });

    // The task/order mutation already committed. Replays also repair downstream delivery after a lost response.
    const downstream = await Promise.allSettled([
      // Sales synchronization invokes the existing idempotent inventory-consumption path first.
      syncWebReservationToSalesOrder(result.orderId),
      syncDiningSessionFromProduction(result.orderId)
    ]);
    for (const item of downstream) if (item.status === "rejected") console.error("pos fulfillment downstream sync", item.reason);
    try { await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(result.orderId)); }
    catch (error) { console.error("pos fulfillment realtime event", error); }
    return Response.json({ ok: true, replayed: result.replayed, selectedStoreId: storeId,
      tasks: await readPosFulfillmentTasks(storeId), undo: result.undo, serverNow: new Date().toISOString() }, { headers });
  } catch (error) {
    const identityFailure = posOperatorDatabaseFailure(error);
    if (identityFailure) return identityFailure;
    console.error("pos fulfillment mutation", error);
    return Response.json({ error: "提供状態を保存できませんでした。同じ操作を再試行してください。" }, { status: 503, headers });
  }
}
