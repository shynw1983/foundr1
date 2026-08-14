import { sql } from "./db";
import { findCustomerOrderById, refundCustomerOrderPayment } from "./customer-orders";
import { reverseLoyaltyForRefundedOrderItem } from "./loyalty";
import { ensureProductionTasksForOrder } from "./order-production";
import { syncWebReservationToSalesOrder } from "./sales-orders";
import { calculateShortageRefundAmount, canHandleShortageAsSeparateOption } from "./store-order-shortage-rules";

type StoredCustomization = {
  groupId?: string;
  groupKey?: string;
  groupName?: string;
  selectionType?: string;
  optionIds?: string[];
  optionKeys?: string[];
  optionLabels?: string[];
  optionPrices?: number[];
  price?: number;
};

export type ShortageCandidate = {
  key: string;
  type: "item" | "option";
  name: string;
  groupName: string;
  price: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function customizations(value: unknown): StoredCustomization[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") as StoredCustomization[] : [];
}

export function buildShortageCandidates(item: {
  id: string;
  itemName: string;
  amount: number;
  customizations: unknown;
  refundStatus?: string;
}) {
  if (item.refundStatus === "refunded") return [];
  const candidates: ShortageCandidate[] = [{
    key: "item",
    type: "item",
    name: item.itemName,
    groupName: "商品全体",
    price: Math.max(0, Number(item.amount) || 0)
  }];
  customizations(item.customizations).forEach((group, groupIndex) => {
    const labels = Array.isArray(group.optionLabels) ? group.optionLabels : [];
    const prices = Array.isArray(group.optionPrices) ? group.optionPrices : [];
    labels.forEach((label, optionIndex) => {
      if (!text(label)) return;
      const optionPrice = Math.max(0, Math.round(Number(prices[optionIndex]) || 0));
      if (!canHandleShortageAsSeparateOption(text(group.groupName), optionPrice)) return;
      candidates.push({
        key: `option:${groupIndex}:${optionIndex}`,
        type: "option",
        name: text(label),
        groupName: text(group.groupName) || "オプション",
        price: optionPrice
      });
    });
  });
  return candidates;
}

function replaceOne(values: string[], original: string, replacement?: string) {
  const normalizedOriginal = text(original);
  const countedIndex = values.findIndex((value) => text(value).startsWith(`${normalizedOriginal} x`));
  if (countedIndex >= 0) {
    const matched = text(values[countedIndex]);
    const count = Math.max(1, Number(matched.slice(matched.lastIndexOf(" x") + 2)) || 1);
    const next = [...values];
    if (count > 2) next[countedIndex] = `${normalizedOriginal} x${count - 1}`;
    else if (count === 2) next[countedIndex] = normalizedOriginal;
    else next.splice(countedIndex, 1);
    if (replacement) next.push(replacement);
    return next;
  }
  const index = values.findIndex((value) => {
    const normalized = text(value);
    return normalized === normalizedOriginal || normalized.endsWith(`: ${normalizedOriginal}`) || normalized.endsWith(`：${normalizedOriginal}`);
  });
  if (index < 0) return values;
  const next = [...values];
  if (replacement) {
    const matched = text(next[index]);
    const separatorIndex = Math.max(matched.lastIndexOf(":"), matched.lastIndexOf("："));
    next[index] = separatorIndex >= 0 ? `${matched.slice(0, separatorIndex + 1)} ${replacement}` : replacement;
  }
  else next.splice(index, 1);
  return next;
}

function mutateOption(
  source: StoredCustomization[],
  groupIndex: number,
  optionIndex: number,
  replacementName: string
) {
  const next = source.map((group) => ({ ...group }));
  const group = next[groupIndex];
  if (!group) return null;
  const labels = Array.isArray(group.optionLabels) ? [...group.optionLabels] : [];
  if (!labels[optionIndex]) return null;
  const originalName = text(labels[optionIndex]);
  const originalKey = text(group.optionKeys?.[optionIndex] ?? group.optionIds?.[optionIndex]);
  for (const field of ["optionIds", "optionKeys", "optionLabels", "optionPrices"] as const) {
    const values: Array<string | number> = Array.isArray(group[field]) ? [...group[field]!] : [];
    if (replacementName) {
      if (field === "optionLabels") values[optionIndex] = replacementName;
      else if (field === "optionIds" || field === "optionKeys") values[optionIndex] = `replacement:${replacementName}`;
    } else {
      values[optionIndex] = field === "optionPrices" ? 0 : "";
    }
    (group as Record<string, unknown>)[field] = values;
  }
  return { customizations: next, originalName, originalKey };
}

export async function handleStoreOrderShortage(input: {
  orderId: string;
  orderItemId: string;
  targetKey: string;
  actionType: "replace" | "refund";
  replacementName?: string;
  employeeId: string;
  employeeName: string;
}) {
  const rows = await sql`
    select
      store_customer_orders.id::text as "orderId",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.shortage_preference as "shortagePreference",
      store_customer_orders.amount::int as "orderAmount",
      store_customer_order_items.id::text as "itemId",
      store_customer_order_items.item_name as "itemName",
      store_customer_order_items.amount::int,
      coalesce(nullif(store_customer_order_items.gross_amount, 0), store_customer_order_items.amount)::int as "grossAmount",
      coalesce(nullif(store_customer_order_items.paid_amount, 0), store_customer_order_items.amount)::int as "paidAmount",
      store_customer_order_items.refunded_amount::int as "refundedAmount",
      coalesce(store_customer_order_items.refund_status, '') as "refundStatus",
      store_customer_order_items.topping_labels as "toppingLabels",
      store_customer_order_items.topping_keys as "toppingKeys",
      coalesce(store_customer_order_items.customizations, '[]'::jsonb) as customizations
    from store_customer_orders
    join store_customer_order_items on store_customer_order_items.order_id = store_customer_orders.id
    where store_customer_orders.id::text = ${input.orderId}
      and store_customer_order_items.id::text = ${input.orderItemId}
    limit 1
  `;
  const target = rows[0] as any;
  if (!target) return { ok: false as const, status: 404, error: "注文商品が見つかりません。" };
  if (!["paid", "partial_refunded"].includes(target.paymentStatus) || !["new", "preparing"].includes(target.status)) {
    return { ok: false as const, status: 409, error: "この注文は欠品対応できる状態ではありません。" };
  }
  if (target.refundStatus === "refunded") return { ok: false as const, status: 409, error: "この商品は返金済みです。" };

  const replacementName = text(input.replacementName);
  if (input.actionType === "replace") {
    if (target.shortagePreference !== "substitute_or_refund") {
      return { ok: false as const, status: 409, error: "お客様は欠品時の返金を選択しています。" };
    }
    if (!replacementName) return { ok: false as const, status: 400, error: "同類の代替商品名を入力してください。" };
  }

  const sourceCustomizations = customizations(target.customizations);
  let targetType: "item" | "option" = "item";
  let targetName = text(target.itemName);
  let targetPrice = Math.max(0, Number(target.grossAmount) || Number(target.amount) || 0);
  let nextCustomizations = sourceCustomizations;
  let nextToppingLabels = Array.isArray(target.toppingLabels) ? target.toppingLabels.map(String) : [];
  let nextToppingKeys = Array.isArray(target.toppingKeys) ? target.toppingKeys.map(String) : [];

  if (input.targetKey !== "item") {
    const match = /^option:(\d+):(\d+)$/.exec(input.targetKey);
    if (!match) return { ok: false as const, status: 400, error: "欠品対象が不正です。" };
    const groupIndex = Number(match[1]);
    const optionIndex = Number(match[2]);
    const mutation = mutateOption(sourceCustomizations, groupIndex, optionIndex, input.actionType === "replace" ? replacementName : "");
    if (!mutation) return { ok: false as const, status: 404, error: "欠品オプションが見つかりません。" };
    targetType = "option";
    targetName = mutation.originalName;
    targetPrice = Math.max(0, Math.round(Number(sourceCustomizations[groupIndex]?.optionPrices?.[optionIndex]) || 0));
    nextCustomizations = mutation.customizations;
    nextToppingLabels = replaceOne(nextToppingLabels, targetName, input.actionType === "replace" ? replacementName : undefined);
    nextToppingKeys = replaceOne(nextToppingKeys, mutation.originalKey, input.actionType === "replace" ? `replacement:${replacementName}` : undefined);
  }

  const existing = await sql`
    select action_type as "actionType", payment_refund_status as "paymentRefundStatus"
    from store_order_shortage_actions
    where order_item_id::text = ${input.orderItemId}
      and target_type = ${targetType}
      and target_key = ${input.targetKey}
    limit 1
  `;
  if (existing[0] && existing[0].paymentRefundStatus !== "failed") {
    return { ok: false as const, status: 409, error: "この欠品対象はすでに対応済みです。" };
  }

  const refundAmount = input.actionType === "refund"
    ? calculateShortageRefundAmount({
        targetType,
        targetPrice,
        grossAmount: Number(target.grossAmount),
        paidAmount: Number(target.paidAmount),
        refundedAmount: Number(target.refundedAmount)
      })
    : 0;
  const actionRows = await sql`
    insert into store_order_shortage_actions (
      order_id, order_item_id, target_type, target_key, target_name, target_snapshot,
      action_type, replacement_name, refund_amount, payment_refund_status, handled_by
    ) values (
      ${input.orderId}, ${input.orderItemId}, ${targetType}, ${input.targetKey}, ${targetName},
      ${JSON.stringify({ price: targetPrice, customizations: sourceCustomizations })}::jsonb,
      ${input.actionType}, ${replacementName}, ${refundAmount}, ${input.actionType === "refund" && refundAmount > 0 ? "pending" : "not_required"}, ${input.employeeId}
    )
    on conflict (order_item_id, target_type, target_key) do update set
      action_type = excluded.action_type,
      replacement_name = excluded.replacement_name,
      refund_amount = excluded.refund_amount,
      payment_refund_status = excluded.payment_refund_status,
      payment_refund_error = '',
      handled_by = excluded.handled_by,
      created_at = now()
    returning id::text
  `;
  const actionId = String(actionRows[0]?.id || "");

  let paymentRefundId = "";
  if (input.actionType === "refund" && refundAmount > 0) {
    const order = await findCustomerOrderById(input.orderId);
    if (!order) return { ok: false as const, status: 404, error: "注文が見つかりません。" };
    const refund = await refundCustomerOrderPayment(order, refundAmount, `Shortage ${order.pickupCode}: ${targetName}`);
    if (!refund.ok) {
      await sql`
        update store_order_shortage_actions
        set payment_refund_status = 'failed', payment_refund_error = ${refund.error}
        where id::text = ${actionId}
      `;
      return { ok: false as const, status: 502, error: `自動返金に失敗しました: ${refund.error}` };
    }
    paymentRefundId = refund.refundId;
  }

  if (targetType === "item" && input.actionType === "replace") {
    await sql`
      update store_customer_order_items
      set item_name = ${replacementName}
      where id::text = ${input.orderItemId}
    `;
  } else if (targetType === "option") {
    await sql`
      update store_customer_order_items
      set customizations = ${JSON.stringify(nextCustomizations)}::jsonb,
          topping_labels = ${nextToppingLabels},
          topping_keys = ${nextToppingKeys}
      where id::text = ${input.orderItemId}
    `;
  }

  if (input.actionType === "refund") {
    await sql`
      update store_customer_order_items
      set
        refund_status = case when ${targetType === "item"} then 'refunded' else 'partial' end,
        refunded_quantity = case when ${targetType === "item"} then quantity else refunded_quantity end,
        refunded_amount = least(coalesce(nullif(paid_amount, 0), amount), refunded_amount + ${refundAmount}),
        refund_reason = ${`欠品: ${targetName}`},
        external_refund_confirmed_at = case when ${refundAmount > 0} then now() else external_refund_confirmed_at end,
        refunded_at = now(),
        refunded_by = ${input.employeeId},
        customizations = ${JSON.stringify(nextCustomizations)}::jsonb,
        topping_labels = ${nextToppingLabels},
        topping_keys = ${nextToppingKeys}
      where id::text = ${input.orderItemId}
    `;
  }

  const openRows = await sql`
    select count(*)::int as count
    from store_customer_order_items
    where order_id::text = ${input.orderId}
      and coalesce(refund_status, '') <> 'refunded'
  `;
  const allItemsRefunded = Number(openRows[0]?.count ?? 0) === 0;
  await sql`
    update store_customer_orders
    set
      amount = greatest(0, amount - ${refundAmount}),
      status = case when ${allItemsRefunded} then 'cancelled' else status end,
      payment_status = case when ${allItemsRefunded} then 'refunded' when ${refundAmount > 0} then 'partial_refunded' else payment_status end,
      payment_refund_status = case when ${allItemsRefunded} then 'succeeded' when ${refundAmount > 0} then 'partial' else payment_refund_status end,
      payment_refund_id = case when ${paymentRefundId !== ""} then ${paymentRefundId} else payment_refund_id end,
      payment_refund_error = '',
      payment_refunded_at = case when ${refundAmount > 0} then now() else payment_refunded_at end,
      cancelled_at = case when ${allItemsRefunded} then coalesce(cancelled_at, now()) else cancelled_at end,
      customer_summary = customer_summary || ${JSON.stringify({
        lastShortageTarget: targetName,
        lastShortageAction: input.actionType,
        lastShortageReplacement: replacementName,
        lastShortageHandledById: input.employeeId,
        lastShortageHandledByName: input.employeeName
      })}::jsonb,
      updated_at = now()
    where id::text = ${input.orderId}
  `;
  await sql`
    update store_order_shortage_actions
    set payment_refund_id = ${paymentRefundId},
        payment_refund_status = ${input.actionType === "refund" && refundAmount > 0 ? "succeeded" : "not_required"},
        payment_refund_error = ''
    where id::text = ${actionId}
  `;

  if (targetType === "item" && input.actionType === "refund") {
    await reverseLoyaltyForRefundedOrderItem({
      orderId: input.orderId,
      itemId: input.orderItemId,
      paidAmount: refundAmount,
      note: "欠品商品返金による会員特典キャンセル"
    });
  }
  await syncWebReservationToSalesOrder(input.orderId);
  if (!allItemsRefunded) await ensureProductionTasksForOrder(input.orderId);
  return { ok: true as const, refundAmount, allItemsRefunded };
}
