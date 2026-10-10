import { canAccessStore, requireOwnerOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { publishOsNotificationEvent } from "../../../../lib/notification-realtime";
import { publishStoreOperationalEvent } from "../../../../lib/order-realtime";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { assertProductsOrderable } from "../../../../lib/product-catalog-access";
import { isHeadquarterCatalogRole } from "../../../../lib/product-catalog-policy";
import { normalizeRecordedProcurementQuantity, resolveProcurementFeedbackConfirmation, type ProcurementFeedbackKind } from "../../../../lib/procurement-confirmation-policy";
import { createReplenishmentOrderLocks, isReplenishmentOrderGuardConflict } from "../../../../lib/replenishment-order-locks";
import { normalizeProductBatchPackaging, productBatchPackagingEquals, type ProductBatchPackaging } from "../../../../lib/product-packaging-policy";

const additionalPurchaseNotePrefix = "追加購入";

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    orderId?: string;
    productId?: string;
    temporaryProductName?: string;
    temporaryProductUnit?: string;
    requestedQuantity?: number;
    note?: string;
  };
  const orderId = String(body.orderId ?? "").trim();
  const productId = String(body.productId ?? "").trim();
  const temporaryProductName = String(body.temporaryProductName ?? "").trim();
  const temporaryProductUnit = String(body.temporaryProductUnit ?? "").trim() || "個";
  const requestedQuantity = Number(body.requestedQuantity ?? 0);
  const note = String(body.note ?? "").trim();

  if (!orderId || (!productId && !temporaryProductName) || !Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return Response.json({ error: "依頼、商品名、数量を指定してください。" }, { status: 400 });
  }

  const orderRows = await sql`
    select
      id,
      store_id::text as "storeId",
      brand_id as "brandId"
    from purchase_orders
    where order_no = ${orderId}
    limit 1
  `;
  const order = orderRows[0];

  if (!order) {
    return Response.json({ error: "依頼が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, order.storeId)) {
    return Response.json({ error: "この依頼に追加購入を登録する権限がありません。" }, { status: 403 });
  }
  if (productId) {
    const access = await assertProductsOrderable(session, String(order.storeId), [productId]);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  } else if (!isHeadquarterCatalogRole(session.role)) {
    return Response.json({ error: "臨時購入品は本部へ登録を依頼してください。" }, { status: 403 });
  }

  const productRows = productId
    ? await sql`
        select
          id,
          unit,
          (
            select product_supplier_options.supplier_id
            from product_supplier_options
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = 'メイン'
              and product_supplier_options.is_active = true
            limit 1
          ) as "mainSupplierId"
        from products
        where id = ${productId}
        limit 1
      `
    : [];
  const product = productRows[0];

  if (productId && !product) {
    return Response.json({ error: "商品が見つかりません。" }, { status: 404 });
  }

  const procurementNote = note
    ? `${additionalPurchaseNotePrefix}: ${temporaryProductName ? `${temporaryProductName} / ${note}` : note}`
    : temporaryProductName
      ? `${additionalPurchaseNotePrefix}: ${temporaryProductName}`
      : additionalPurchaseNotePrefix;

  let insertedRows: Record<string, any>[];
  try {
    const results = await sql.transaction([
      ...createReplenishmentOrderLocks(sql, [{ storeId: String(order.storeId), productIds: [product?.id] }], String(order.id)),
      sql`select 1 / count(*)::int from purchase_orders where id = ${order.id} and store_id::text = ${String(order.storeId)}`,
      sql`
    insert into purchase_order_items (
      purchase_order_id,
      product_id,
      brand_id,
      temporary_product_name,
      temporary_product_unit,
      requested_quantity,
      requested_unit,
      note,
      procurement_note,
      selected_supplier_id,
      status
    )
    values (
      ${order.id},
      ${product?.id ?? null},
      ${order.brandId},
      ${temporaryProductName},
      ${temporaryProductUnit},
      ${requestedQuantity},
      ${product?.unit ?? temporaryProductUnit},
      ${additionalPurchaseNotePrefix},
      ${procurementNote},
      ${product?.mainSupplierId ?? null},
      'requested'
    )
    returning id::text
      `,

      sql`
    update purchase_orders
    set
      requested_item_count = (
        select count(*)::int
        from purchase_order_items
        where purchase_order_id = ${order.id}
      ),
      updated_at = now()
    where id = ${order.id}
      `
    ]);
    insertedRows = results[results.length - 2];
  } catch (error) {
    if (!isReplenishmentOrderGuardConflict(error)) throw error;
    return Response.json({ error: "確認対象の状態が変わりました。最新の内容を確認してください。" }, { status: 409 });
  }

  await publishStoreOperationalEvent(order.storeId, "procurement.updated").catch(() => undefined);
  return Response.json({ ok: true, itemId: insertedRows[0]?.id ?? "" });
}

export async function PATCH(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    itemId?: string;
    productId?: string;
    productName?: string;
    unit?: string;
    requestedQuantity?: number;
    purchased?: boolean;
    unavailable?: boolean;
    actualQuantity?: number;
    actualPackaging?: unknown;
    actualQuantityRecordedExplicitly?: boolean;
    actualPrice?: string;
    supplierLocationName?: string;
    note?: string;
    supplier?: string;
    deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
    clearActualPrice?: boolean;
    confirmStoreFeedback?: boolean;
    confirmFeedbackKind?: ProcurementFeedbackKind;
    historyCorrection?: boolean;
    correctRequestedQuantity?: boolean;
    splitRemaining?: boolean;
    remainingSupplier?: string;
  };

  if (!body.itemId) {
    return Response.json({ error: "itemId is required" }, { status: 400 });
  }

  const itemRows = await sql`
    select purchase_orders.store_id::text as "storeId"
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    where purchase_order_items.id = ${body.itemId}
    limit 1
  `;

  if (!itemRows[0]) {
    return Response.json({ error: "発注明細が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, itemRows[0].storeId)) {
    return Response.json({ error: "この発注明細を操作する権限がありません。" }, { status: 403 });
  }

  const detailRows = await sql`
    select
      purchase_order_items.purchase_order_id::text as "purchaseOrderId",
      purchase_order_items.id::text as "itemId",
      purchase_order_items.product_id::text as "currentProductId",
      purchase_order_items.brand_id::text as "brandId",
      coalesce(purchase_order_items.temporary_product_name, '') as "currentTemporaryProductName",
      coalesce(purchase_order_items.temporary_product_unit, '') as "currentTemporaryProductUnit",
      purchase_orders.order_no as "orderNo",
      purchase_orders.store_id::text as "storeId",
      stores.name as "storeName",
      coalesce(nullif(purchase_order_items.temporary_product_name, ''), products.name, '臨時購入品') as "productName",
      coalesce(products.reference_price::float, 0) as "referencePrice",
      purchase_order_items.status as "currentStatus",
      purchase_actuals.id is not null as "currentHasPurchaseActual",
      coalesce(purchase_order_items.procurement_note, '') as "currentNote",
      coalesce(purchase_order_items.note, '') as "requestNote",
      coalesce(purchase_order_items.procurement_note, '') like ${`${additionalPurchaseNotePrefix}%`} as "isAdditionalPurchase",
      purchase_order_items.selected_supplier_id::text as "currentSupplierId",
      purchase_order_items.store_feedback_confirmed_at is not null as "storeFeedbackConfirmed",
      purchase_order_items.requested_quantity::float as "requestedQuantity",
      purchase_order_items.requested_unit as "requestedUnit",
      coalesce(
        purchase_order_items.actual_quantity::float,
        purchase_actuals.actual_quantity::float
      ) as "currentActualQuantity",
      coalesce(
        purchase_order_items.actual_price::float,
        purchase_actuals.actual_price::float
      ) as "currentActualPrice",
      to_jsonb(purchase_order_items) as "mutationItemSnapshot",
      coalesce(to_jsonb(purchase_actuals), 'null'::jsonb) as "mutationActualSnapshot",
      coalesce((
        select jsonb_agg(jsonb_build_object('link', to_jsonb(links), 'batch', to_jsonb(batches)) order by links.delivery_batch_id)
        from delivery_batch_items links join delivery_batches batches on batches.id = links.delivery_batch_id
        where links.purchase_order_item_id = purchase_order_items.id
      ), '[]'::jsonb) as "mutationDeliverySnapshot"
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    join stores on stores.id = purchase_orders.store_id
    left join products on products.id = purchase_order_items.product_id
    left join lateral (
      select purchase_actuals.*
      from purchase_actuals
      where purchase_actuals.purchase_order_item_id = purchase_order_items.id
      order by purchase_actuals.recorded_at desc, purchase_actuals.id desc
      limit 1
    ) purchase_actuals on true
    where purchase_order_items.id = ${body.itemId}
    limit 1
  `;
  const itemDetail = detailRows[0];
  if (!itemDetail) return Response.json({ error: "発注明細が見つかりません。" }, { status: 404 });
  if (itemDetail.storeId !== itemRows[0].storeId) {
    return Response.json({ error: "確認対象の状態が変わりました。最新の内容を確認してください。" }, { status: 409 });
  }

  const confirmation = resolveProcurementFeedbackConfirmation(body, {
    currentStatus: String(itemDetail?.currentStatus ?? ""),
    requestedQuantity: Number(itemDetail?.requestedQuantity ?? 0)
  });
  if (confirmation && "error" in confirmation) {
    return Response.json({ error: confirmation.error }, { status: confirmation.status ?? 400 });
  }
  if (confirmation) {
    const kind = confirmation.kind;
    const confirmedRows = await sql`
      with facts as (
        select
          purchase_order_items.id,
          purchase_order_items.purchase_order_id,
          purchase_order_items.status,
          purchase_order_items.price_feedback_confirmation as previous_price_snapshot,
          purchase_order_items.quantity_feedback_confirmation as previous_quantity_snapshot,
          purchase_order_items.store_feedback_confirmed_at as previous_store_confirmation,
          coalesce(nullif(purchase_order_items.temporary_product_name, ''), products.name, '臨時購入品') as product_name,
          coalesce(purchase_order_items.procurement_note, '') as procurement_note,
          jsonb_build_object(
            'actualPrice', coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price),
            'referencePrice', products.reference_price,
            'productId', coalesce(purchase_order_items.product_id::text, ''),
            'unit', purchase_order_items.requested_unit
          ) as price_snapshot,
          jsonb_build_object(
            'actualQuantity', coalesce(purchase_order_items.actual_quantity, purchase_actuals.actual_quantity),
            'requestedQuantity', purchase_order_items.requested_quantity,
            'productId', coalesce(purchase_order_items.product_id::text, ''),
            'unit', purchase_order_items.requested_unit
          ) as quantity_snapshot
        from purchase_order_items
        left join products on products.id = purchase_order_items.product_id
        left join lateral (
          select actual_quantity, actual_price
          from purchase_actuals
          where purchase_actuals.purchase_order_item_id = purchase_order_items.id
          order by recorded_at desc
          limit 1
        ) purchase_actuals on true
        where purchase_order_items.id = ${body.itemId}
          and (
            (${kind} = 'price' and purchase_order_items.status in ('in_delivery', 'delivered', 'received')
              and coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price) > 0
              and products.reference_price > 0)
            or (${kind} = 'quantity' and purchase_order_items.status in ('in_delivery', 'delivered', 'received')
              and coalesce(purchase_order_items.actual_quantity, purchase_actuals.actual_quantity) is not null)
            or (${kind} = 'unavailable' and purchase_order_items.status = 'unavailable')
            or (${kind} = 'note' and coalesce(purchase_order_items.procurement_note, '') <> '' and purchase_order_items.status in ('in_delivery', 'delivered', 'received'))
          )
        for update of purchase_order_items
      ), eligible as (
        select * from facts
        where ${confirmation.expectedSnapshot === undefined}
          or case
            when ${kind} = 'price' then facts.price_snapshot = ${JSON.stringify(confirmation.expectedSnapshot ?? null)}::jsonb
            when ${kind} = 'quantity' then facts.quantity_snapshot = ${JSON.stringify(confirmation.expectedSnapshot ?? null)}::jsonb
            else true
          end
      ), confirmed as (
        update purchase_order_items
        set
          price_feedback_confirmation = case when ${kind} = 'price' then facts.price_snapshot else purchase_order_items.price_feedback_confirmation end,
          quantity_feedback_confirmation = case when ${kind} = 'quantity' then facts.quantity_snapshot else purchase_order_items.quantity_feedback_confirmation end,
          store_feedback_confirmed_at = case when ${kind} in ('note', 'unavailable') then now() else purchase_order_items.store_feedback_confirmed_at end,
          store_feedback_confirmed_by = case when ${kind} in ('note', 'unavailable') then ${session.id}::uuid else purchase_order_items.store_feedback_confirmed_by end
        from eligible facts
        where purchase_order_items.id = facts.id
        returning purchase_order_items.id, facts.purchase_order_id, facts.product_name,
          facts.procurement_note, facts.price_snapshot, facts.quantity_snapshot,
          facts.previous_price_snapshot, facts.previous_quantity_snapshot, facts.previous_store_confirmation
      ), recorded as (
        insert into purchase_exceptions (
          purchase_order_id, purchase_order_item_id, exception_type, message,
          resolution_note, needs_store_confirmation, affects_operation,
          status, resolved_by, resolved_at, updated_at
        )
        select
          confirmed.purchase_order_id, confirmed.id, ${kind},
          case
            when ${kind} = 'price' then concat('実際 ¥', confirmed.price_snapshot->>'actualPrice', ' / 基準 ¥', confirmed.price_snapshot->>'referencePrice')
            when ${kind} = 'quantity' then concat('依頼 ', confirmed.quantity_snapshot->>'requestedQuantity', ' / 実数 ', confirmed.quantity_snapshot->>'actualQuantity', ' ', confirmed.quantity_snapshot->>'unit')
            when ${kind} = 'unavailable' then concat(confirmed.product_name, ' は本依頼で購入不可として店舗確認済みです。 ', confirmed.procurement_note)
            else confirmed.procurement_note
          end,
          '店舗確認済み', true, ${kind} = 'unavailable', 'resolved', ${session.id}::uuid, now(), now()
        from confirmed
        where case
          when ${kind} = 'price' then confirmed.previous_price_snapshot is distinct from confirmed.price_snapshot
          when ${kind} = 'quantity' then confirmed.previous_quantity_snapshot is distinct from confirmed.quantity_snapshot
          else confirmed.previous_store_confirmation is null
        end
        returning id
      )
      select id::text from confirmed
    `;
    if (!confirmedRows[0]) {
      return Response.json({ error: "確認対象の状態が変わりました。最新の内容を確認してください。" }, { status: 409 });
    }
    await publishStoreOperationalEvent(String(itemDetail.storeId), "procurement.updated").catch(() => undefined);
    return Response.json({ ok: true, confirmedFeedbackKind: kind });
  }

  const currentStatus = String(itemDetail?.currentStatus ?? "");
  const isDeliveryLocked = ["in_delivery", "delivered", "received"].includes(currentStatus);
  const isHistoryCorrection = body.historyCorrection === true;
  if (isHistoryCorrection && !(await roleHasPermission(session.role, "history.correct"))) {
    return Response.json({ error: "履歴修正の権限がありません。" }, { status: 403 });
  }
  const requestedDeliveryStatus = String(body.deliveryStatus ?? "");
  const actualQuantity = normalizeRecordedProcurementQuantity(body.actualQuantity);
  if (body.actualQuantity !== undefined && body.actualQuantity !== null && actualQuantity === null) {
    return Response.json({ error: "実際の購入数量を正しい数値で入力してください。" }, { status: 400 });
  }
  if (
    !isHistoryCorrection && actualQuantity !== null &&
    normalizeRecordedProcurementQuantity(itemDetail?.currentActualQuantity) === null &&
    body.actualQuantityRecordedExplicitly !== true
  ) {
    return Response.json({ error: "確認対象の状態が変わりました。最新の内容を確認してください。" }, { status: 409 });
  }
  const recordedActualQuantity = actualQuantity ?? normalizeRecordedProcurementQuantity(itemDetail?.currentActualQuantity);
  const splitRemaining = body.splitRemaining === true;
  const splitPurchasedQuantity = splitRemaining && actualQuantity !== null ? Math.max(0, Number(actualQuantity)) : null;
  const currentRequestedQuantity = Number(itemDetail?.requestedQuantity ?? 0);
  const splitRemainingQuantity = splitPurchasedQuantity !== null ? Math.max(0, currentRequestedQuantity - splitPurchasedQuantity) : 0;
  const requestedQuantity = splitRemaining && splitPurchasedQuantity !== null
    ? splitPurchasedQuantity
    : isHistoryCorrection && body.correctRequestedQuantity === true && Number.isFinite(body.requestedQuantity)
    ? Math.max(0, Number(body.requestedQuantity))
    : null;
  const hasActualPrice = body.actualPrice !== undefined;
  const actualPriceText = String(body.actualPrice ?? "").trim();
  const normalizedActualPrice = actualPriceText.replace(/[¥￥,\s]/g, "");
  const actualPrice = normalizedActualPrice ? Number(normalizedActualPrice) : null;
  const hasNote = body.note !== undefined;
  const note = body.note ?? "";
  const hasProductChange = body.productId !== undefined || body.productName !== undefined || body.unit !== undefined;
  const nextProductId = String(body.productId ?? "").trim();
  const nextProductName = String(body.productName ?? "").trim();
  const nextUnit = String(body.unit ?? "").trim();
  const productActuallyChanged = hasProductChange && (
    String(itemDetail?.currentProductId ?? "") !== nextProductId ||
    (!nextProductId && nextProductName && String(itemDetail?.currentTemporaryProductName ?? "") !== nextProductName) ||
    (nextUnit && String(itemDetail?.requestedUnit ?? "") !== nextUnit)
  );
  const hasActualPackaging = Object.prototype.hasOwnProperty.call(body, "actualPackaging");
  const previousPackaging = (itemDetail.mutationItemSnapshot?.actual_packaging_snapshot ?? itemDetail.mutationActualSnapshot?.packaging_snapshot ?? null) as ProductBatchPackaging | null;
  let actualPackaging: ProductBatchPackaging | null = productActuallyChanged ? null : previousPackaging;
  if (hasActualPackaging) {
    try { actualPackaging = body.actualPackaging === null ? null : normalizeProductBatchPackaging(body.actualPackaging); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "今回の包装仕様を確認してください。" }, { status: 400 }); }
    if (body.purchased !== true) return Response.json({ error: "実際の包装仕様は購入記録と一緒に保存してください。" }, { status: 400 });
  }
  const actualPackagingChanged = actualPackaging === null ? previousPackaging !== null : !productBatchPackagingEquals(actualPackaging, previousPackaging);
  const actualPurchaseUnit = actualPackaging?.purchaseUnit ?? String(itemDetail.requestedUnit ?? "");
  if(splitRemaining && actualPurchaseUnit!==String(itemDetail.requestedUnit??"")) return Response.json({error:"実際の購入単位が依頼単位と異なる場合、残数を自動で分割できません。依頼単位の残数を確認して別明細で登録してください。"},{status:409});
  const receiptFactsWouldChange = productActuallyChanged
    || actualPackagingChanged
    || body.purchased === false || body.unavailable === true || splitRemaining
    || (requestedQuantity !== null && requestedQuantity !== currentRequestedQuantity)
    || (actualQuantity !== null && actualQuantity !== Number(itemDetail.currentActualQuantity))
    || (requestedDeliveryStatus !== "" && requestedDeliveryStatus !== "received" && requestedDeliveryStatus !== currentStatus)
    || (body.purchased === true && String(itemDetail.mutationActualSnapshot?.actual_unit ?? "") !== actualPurchaseUnit);
  if (receiptFactsWouldChange) {
    const postedReceipts = await sql`
      select id from inventory_stock_receipts where purchase_order_item_id = ${body.itemId}::uuid limit 1
    `;
    if (postedReceipts[0]) {
      return Response.json({ error: "入庫済みの発注明細は商品・数量・単位・配送状態を変更できません。追加分は別の発注で登録してください。" }, { status: 409 });
    }
  }
  if (productActuallyChanged) {
    if (nextProductId) {
      const access = await assertProductsOrderable(session, String(itemRows[0].storeId), [nextProductId]);
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
    } else if (!isHeadquarterCatalogRole(session.role)) {
      return Response.json({ error: "臨時購入品は本部へ登録を依頼してください。" }, { status: 403 });
    }
  }
  const addsCurrentSkuDemand = splitRemaining || (
    !isHistoryCorrection && requestedQuantity !== null && requestedQuantity > Number(itemDetail?.requestedQuantity ?? 0)
  );
  if (addsCurrentSkuDemand) {
    const demandedProductId = String(itemDetail?.currentProductId ?? "");
    if (demandedProductId) {
      const access = await assertProductsOrderable(session, String(itemRows[0].storeId), [demandedProductId]);
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
    } else if (!isHeadquarterCatalogRole(session.role)) {
      return Response.json({ error: "臨時購入品は本部へ登録を依頼してください。" }, { status: 403 });
    }
  }
  if (
    isDeliveryLocked &&
    !isHistoryCorrection &&
    (body.purchased === false || body.unavailable === true || requestedDeliveryStatus === "pending" || productActuallyChanged || splitRemaining)
  ) {
    return Response.json({ error: "配送中または納品済みの商品は未配送に戻せません。" }, { status: 409 });
  }
  if (splitRemaining) {
    if (!itemDetail) return Response.json({ error: "発注明細が見つかりません。" }, { status: 404 });
    if (itemDetail.currentStatus === "unavailable") return Response.json({ error: "購入不可の商品は残数フォローに回せません。" }, { status: 400 });
    if (splitPurchasedQuantity === null || splitPurchasedQuantity <= 0 || splitPurchasedQuantity >= currentRequestedQuantity) {
      return Response.json({ error: "今回購入数量は依頼数量より少ない正の数にしてください。" }, { status: 400 });
    }
  }
  const shouldClearPriceException = body.purchased !== undefined || hasActualPrice || hasNote;
  const shouldResetStoreFeedbackConfirmation =
    !isHistoryCorrection &&
    ((hasNote && note !== itemDetail?.currentNote) || (body.unavailable === true && itemDetail?.currentStatus !== "unavailable"));
  const deliveryStatus = ["in_delivery", "delivered", "received"].includes(body.deliveryStatus ?? "")
    ? body.deliveryStatus
    : null;
  const supplierName = String(body.supplier ?? "").trim();
  const supplierLocationName = String(body.supplierLocationName ?? "").trim();
  const hasSupplierInput = supplierName.length > 0;
  const isRecordingPurchase = body.purchased === true && body.unavailable !== true;
  const alreadyPurchased = itemDetail?.currentHasPurchaseActual === true
    || ["purchased", "in_delivery", "delivered", "received"].includes(currentStatus);
  if (isRecordingPurchase && !alreadyPurchased && recordedActualQuantity === null) {
    return Response.json({ error: "購入済みにする前に実際の購入数量を入力してください。" }, { status: 400 });
  }
  const purchaseRecordPrice = hasActualPrice ? actualPrice : normalizeRecordedProcurementQuantity(itemDetail?.currentActualPrice);
  const supplierRows = supplierName
    ? isRecordingPurchase
      ? await sql`
          insert into suppliers (
            name,
            channel_type,
            updated_at
          )
          values (
            ${supplierName},
            '実店舗',
            now()
          )
          on conflict (name)
          do update set updated_at = now()
          returning id
        `
      : await sql`
          select id
          from suppliers
          where name = ${supplierName}
          limit 1
        `
    : [];
  const supplierId = supplierRows[0]?.id ?? null;
  const effectiveSupplierId = String(supplierId ?? itemDetail?.currentSupplierId ?? "").trim();
  const effectiveSupplierRows = isRecordingPurchase
    ? effectiveSupplierId
      ? await sql`
        select channel_type as "channelType"
        from suppliers
        where id = ${effectiveSupplierId}::uuid
        limit 1
      `
      : []
    : [];
  const supplierRequiresLocation = String(effectiveSupplierRows[0]?.channelType ?? "") === "チェーン店";
  if (isRecordingPurchase && supplierRequiresLocation && !supplierLocationName) {
    return Response.json({ error: "チェーン店で購入する場合は、実際に購入した店舗を選択または入力してください。" }, { status: 400 });
  }
  const supplierLocationRows = supplierRequiresLocation && supplierLocationName && supplierId
    ? await sql`
        insert into supplier_locations (
          supplier_id,
          name,
          location_type
        )
        values (
          ${supplierId}::uuid,
          ${supplierLocationName},
          '実店舗'
        )
        on conflict (supplier_id, name)
        do update set name = excluded.name
        returning id
      `
    : [];
  const supplierLocationId = supplierLocationRows[0]?.id ?? null;
  if (isRecordingPurchase && supplierRequiresLocation && !supplierLocationId) {
    return Response.json({ error: "発注先に店舗・支店を登録してから購入済みにしてください。" }, { status: 400 });
  }
  const remainingSupplierName = String(body.remainingSupplier ?? "").trim();
  const hasRemainingSupplierInput = remainingSupplierName.length > 0;
  const remainingSupplierRows = remainingSupplierName
    ? await sql`
        select id
        from suppliers
        where name = ${remainingSupplierName}
        limit 1
      `
    : [];
  const remainingSupplierId = remainingSupplierRows[0]?.id ?? null;

  const nextProductRows = nextProductId
    ? await sql`
        select
          products.id,
          products.name,
          products.unit,
          (
            select product_supplier_options.supplier_id
            from product_supplier_options
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = 'メイン'
              and product_supplier_options.is_active = true
            limit 1
          ) as "mainSupplierId"
        from products
        where products.id::text = ${nextProductId}
        limit 1
      `
    : [];
  const nextProduct = nextProductRows[0];

  if (nextProductId && !nextProduct) {
    return Response.json({ error: "購入した商品が見つかりません。" }, { status: 404 });
  }

  const writeQueries = [
    ...createReplenishmentOrderLocks(sql, [{
      storeId: String(itemDetail.storeId),
      productIds: [itemDetail.currentProductId, productActuallyChanged ? nextProduct?.id : null]
    }], String(itemDetail.purchaseOrderId)),
    sql`select id from purchase_order_items where id = ${body.itemId} for update`,
    sql`
      select 1 / count(*)::int from purchase_order_items items
      join purchase_orders orders on orders.id = items.purchase_order_id
      where items.id = ${body.itemId} and orders.id::text = ${String(itemDetail.purchaseOrderId)}
        and orders.store_id::text = ${String(itemDetail.storeId)}
        and items.product_id::text is not distinct from ${itemDetail.currentProductId ?? null}::text
        and (${!receiptFactsWouldChange} or not exists (
          select 1 from inventory_stock_receipts where purchase_order_item_id = items.id
        ))
        and to_jsonb(items) = ${JSON.stringify(itemDetail.mutationItemSnapshot ?? null)}::jsonb
        and coalesce((
          select to_jsonb(actuals) from purchase_actuals actuals
          where actuals.purchase_order_item_id = items.id
          order by actuals.recorded_at desc, actuals.id desc limit 1
        ), 'null'::jsonb) = ${JSON.stringify(itemDetail.mutationActualSnapshot ?? null)}::jsonb
        and coalesce((
          select jsonb_agg(jsonb_build_object('link', to_jsonb(links), 'batch', to_jsonb(batches)) order by links.delivery_batch_id)
          from delivery_batch_items links join delivery_batches batches on batches.id = links.delivery_batch_id
          where links.purchase_order_item_id = items.id
        ), '[]'::jsonb) = ${JSON.stringify(itemDetail.mutationDeliverySnapshot ?? [])}::jsonb
    `
  ];
  if (body.purchased === false || body.unavailable === true) {
    writeQueries.push(sql`
      delete from delivery_batch_items
      where purchase_order_item_id = ${body.itemId}
    `);
  }

  if (itemDetail) {
    if (body.unavailable === true && itemDetail.currentStatus !== "unavailable") {
      writeQueries.push(sql`
        insert into purchase_exceptions (
          purchase_order_id,
          purchase_order_item_id,
          exception_type,
          message,
          resolution_note,
          needs_store_confirmation,
          affects_operation,
          status,
          resolved_by,
          resolved_at,
          updated_at
        ) values (
          ${itemDetail.purchaseOrderId},
          ${itemDetail.itemId},
          'unavailable',
          ${`${itemDetail.productName} は本依頼で購入不可として処理しました。${note ? ` 理由: ${note}` : ""}`},
          '購入不可',
          false,
          true,
          'resolved',
          ${session.id},
          now(),
          now()
        )
      `);
    } else if (body.unavailable === true && itemDetail.currentStatus === "unavailable") {
      writeQueries.push(sql`
        update purchase_exceptions
        set
          message = ${`${itemDetail.productName} は本依頼で購入不可として処理しました。${note ? ` 理由: ${note}` : ""}`},
          updated_at = now()
        where id = (
          select id
          from purchase_exceptions
          where purchase_order_item_id = ${itemDetail.itemId}
            and exception_type = 'unavailable'
          order by created_at desc
          limit 1
        )
      `);
    }
  }

  writeQueries.push(sql`
    update purchase_order_items
    set
      status = case
        when ${body.unavailable === true} then 'unavailable'
        when ${body.unavailable === false && itemDetail?.currentStatus === "unavailable"} then 'requested'
        when ${body.purchased === false} then 'requested'
        when ${deliveryStatus}::text is not null then ${deliveryStatus}
        when status in ('in_delivery', 'delivered', 'received') then status
        when ${splitRemaining} then 'purchased'
        when ${body.purchased === true} then 'purchased'
        else status
      end,
      requested_quantity = case
        when ${requestedQuantity}::numeric is not null and ${requestedQuantity}::numeric > 0 then ${requestedQuantity}
        else requested_quantity
      end,
      actual_quantity = case
        when ${body.unavailable === true} then 0
        else coalesce(${actualQuantity}, actual_quantity)
      end,
      actual_packaging_snapshot = case
        when ${body.purchased === false || body.unavailable === true || productActuallyChanged || hasActualPackaging} then ${actualPackaging === null || body.purchased === false || body.unavailable === true ? null : JSON.stringify(actualPackaging)}::jsonb
        else actual_packaging_snapshot
      end,
      actual_price = case
        when ${body.unavailable === true} then null
        when ${hasActualPrice} then ${Number.isFinite(actualPrice) ? actualPrice : null}
        else actual_price
      end,
      procurement_note = case
        when ${hasNote} then ${note}
        else procurement_note
      end,
      price_exception_note = case
        when ${shouldClearPriceException} then ''
        else price_exception_note
      end,
      product_id = case
        when ${productActuallyChanged} then ${nextProduct?.id ?? null}
        else product_id
      end,
      temporary_product_name = case
        when ${productActuallyChanged} then ${nextProduct ? "" : nextProductName}
        else temporary_product_name
      end,
      temporary_product_unit = case
        when ${productActuallyChanged} then ${nextProduct ? "" : nextUnit}
        else temporary_product_unit
      end,
      requested_unit = case
        when ${productActuallyChanged} then ${nextProduct ? String(nextProduct.unit ?? "") : nextUnit || itemDetail?.requestedUnit || "個"}
        else requested_unit
      end,
      selected_supplier_id = case
        when ${hasSupplierInput} then ${supplierId}::uuid
        when ${productActuallyChanged} then ${nextProduct?.mainSupplierId ?? null}::uuid
        else selected_supplier_id
      end,
      store_feedback_confirmed_at = case
        when ${shouldResetStoreFeedbackConfirmation} then null
        else store_feedback_confirmed_at
      end,
      store_feedback_confirmed_by = case
        when ${shouldResetStoreFeedbackConfirmation} then null
        else store_feedback_confirmed_by
      end
    where id = ${body.itemId}
  `);

  if (splitRemaining && itemDetail && splitPurchasedQuantity !== null && splitRemainingQuantity > 0) {
    writeQueries.push(sql`
      insert into purchase_order_items (
        purchase_order_id,
        product_id,
        brand_id,
        temporary_product_name,
        temporary_product_unit,
        requested_quantity,
        requested_unit,
        note,
        procurement_note,
        selected_supplier_id,
        status
      )
      values (
        ${itemDetail.purchaseOrderId},
        ${itemDetail.currentProductId || null},
        ${itemDetail.brandId || null},
        ${String(itemDetail.currentTemporaryProductName ?? "")},
        ${String(itemDetail.currentTemporaryProductUnit ?? "") || String(itemDetail.requestedUnit ?? "個")},
        ${splitRemainingQuantity},
        ${String(itemDetail.requestedUnit ?? "個")},
        ${String(itemDetail.requestNote ?? "")},
        ${[
          String(itemDetail.currentNote ?? "").trim(),
          hasRemainingSupplierInput && !remainingSupplierId ? `臨時購入先: ${remainingSupplierName}` : "",
          `残数フォロー: 元明細 ${itemDetail.itemId} / 元依頼 ${currentRequestedQuantity} ${itemDetail.requestedUnit} / 今回購入 ${splitPurchasedQuantity} ${itemDetail.requestedUnit} / 残数 ${splitRemainingQuantity} ${itemDetail.requestedUnit}`
        ].filter(Boolean).join("\n")},
        ${hasRemainingSupplierInput ? remainingSupplierId : itemDetail.currentSupplierId ?? null}::uuid,
        'requested'
      )
    `);

    writeQueries.push(sql`
      update purchase_orders
      set
        requested_item_count = (
          select count(*)::int
          from purchase_order_items
          where purchase_order_id = ${itemDetail.purchaseOrderId}
        ),
        updated_at = now()
      where id = ${itemDetail.purchaseOrderId}
    `);
  }

  if (body.purchased === false || body.unavailable === true) {
    writeQueries.push(sql`
      delete from purchase_actuals
      where purchase_order_item_id = ${body.itemId}
    `);

    writeQueries.push(sql`
      delete from price_records
      where source = 'purchase_actual'
        and receipt_note = ${body.itemId}
    `);
  }

  if (body.purchased && body.unavailable !== true) {
    writeQueries.push(sql`
      delete from purchase_actuals
      where purchase_order_item_id = ${body.itemId}
    `);

    writeQueries.push(sql`
      insert into purchase_actuals (
        purchase_order_item_id,
        supplier_id,
        supplier_location_id,
        actual_quantity,
        actual_unit,
        actual_price,
        price_is_exception,
        note,
        packaging_snapshot
      )
      select
        purchase_order_items.id,
        coalesce(${supplierId}::uuid, purchase_order_items.selected_supplier_id),
        ${supplierLocationId}::uuid,
        coalesce(${actualQuantity}::numeric, purchase_order_items.actual_quantity, ${recordedActualQuantity}::numeric),
        coalesce(purchase_order_items.actual_packaging_snapshot->>'purchaseUnit', purchase_order_items.requested_unit),
        ${Number.isFinite(purchaseRecordPrice) ? purchaseRecordPrice : null},
        false,
        ${hasNote ? note : itemDetail?.currentNote ?? ""},
        purchase_order_items.actual_packaging_snapshot
      from purchase_order_items
      where purchase_order_items.id = ${body.itemId}
    `);

    if (Number.isFinite(purchaseRecordPrice)) {
      writeQueries.push(sql`
        delete from price_records
        where source = 'purchase_actual'
          and receipt_note = ${body.itemId}
      `);

      writeQueries.push(sql`
        insert into price_records (
          product_id,
          supplier_id,
          price,
          unit,
          source,
          receipt_note,
          recorded_by,
          packaging_snapshot
        )
        select
          purchase_order_items.product_id,
          coalesce(${supplierId}::uuid, purchase_order_items.selected_supplier_id),
          ${purchaseRecordPrice},
          coalesce(purchase_order_items.actual_packaging_snapshot->>'purchaseUnit', purchase_order_items.requested_unit),
          'purchase_actual',
          ${body.itemId},
          ${session.id},
          purchase_order_items.actual_packaging_snapshot
        from purchase_order_items
        where purchase_order_items.id = ${body.itemId}
          and purchase_order_items.product_id is not null
      `);
    }
  }

  try {
    await sql.transaction(writeQueries);
  } catch (error) {
    if (!isReplenishmentOrderGuardConflict(error)) throw error;
    return Response.json({ error: "確認対象の状態が変わりました。最新の内容を確認してください。" }, { status: 409 });
  }

  if (
    deliveryStatus === "delivered" &&
    itemDetail &&
    !itemDetail.isAdditionalPurchase &&
    !["delivered", "received"].includes(String(itemDetail.currentStatus ?? ""))
  ) {
    const insertedNotifications = await sql`
      insert into os_notifications (
        recipient_employee_id,
        notification_type,
        title,
        message,
        href
      )
      select distinct
        employees.id,
        'store_confirmation_required',
        '店舗確認が必要です',
        ${`${itemDetail.storeName} に ${itemDetail.productName} が納品済みです。`},
        ${`/os/orders#order-${itemDetail.orderNo}`}
      from employees
      left join employee_scopes
        on employee_scopes.employee_id = employees.id
        and employee_scopes.scope_type = 'store'
      where employees.status = 'active'
        and (
          employees.role in ('owner', 'manager')
          or employee_scopes.store_id::text = ${itemDetail.storeId}
        )
        and not exists (
          select 1
          from os_notifications
          where os_notifications.recipient_employee_id = employees.id
            and os_notifications.notification_type = 'store_confirmation_required'
            and os_notifications.href = ${`/os/orders#order-${itemDetail.orderNo}`}
            and os_notifications.created_at > now() - interval '30 minutes'
        )
      returning recipient_employee_id::text as "employeeId"
    `;
    await Promise.all(insertedNotifications.map((notification) =>
      publishOsNotificationEvent(String(notification.employeeId)).catch(() => undefined)
    ));
  }

  await publishStoreOperationalEvent(itemDetail.storeId, "procurement.updated").catch(() => undefined);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { itemId?: string };
  const itemId = String(body.itemId ?? "").trim();

  if (!itemId) {
    return Response.json({ error: "itemId is required" }, { status: 400 });
  }

  const itemRows = await sql`
    select
      purchase_order_items.purchase_order_id as "purchaseOrderId",
      purchase_orders.store_id::text as "storeId",
      purchase_order_items.product_id::text as "productId"
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    where purchase_order_items.id = ${itemId}
    limit 1
  `;
  const purchaseOrderId = itemRows[0]?.purchaseOrderId;

  if (!purchaseOrderId) {
    return Response.json({ error: "発注明細が見つかりません。" }, { status: 404 });
  }

  try {
    await sql.transaction([
      ...createReplenishmentOrderLocks(sql, [{ storeId: String(itemRows[0].storeId), productIds: [itemRows[0].productId] }], String(purchaseOrderId)),
      sql`select id from purchase_order_items where id = ${itemId}::uuid for update`,
      sql`select 1 / case when exists (
        select 1 from inventory_stock_receipts where purchase_order_item_id = ${itemId}::uuid
      ) then 0 else 1 end`,
      sql`delete from purchase_order_items where id = ${itemId}::uuid`,
      sql`
        update purchase_orders
        set requested_item_count = (select count(*)::int from purchase_order_items where purchase_order_id = ${purchaseOrderId}),
          updated_at = now()
        where id = ${purchaseOrderId}
      `
    ]);
  } catch (error) {
    if (!isReplenishmentOrderGuardConflict(error) && !(error && typeof error === "object" && "code" in error && (error.code === "23503" || error.code === "23001"))) throw error;
    return Response.json({ error: "入庫履歴がある発注明細は削除できません。" }, { status: 409 });
  }

  await publishStoreOperationalEvent(itemRows[0].storeId, "procurement.updated").catch(() => undefined);
  return Response.json({ ok: true });
}

function formatPriceForMessage(value: number) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}
