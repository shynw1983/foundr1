import { canAccessStore, requireOwnerOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

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

  const insertedRows = await sql`
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
  `;

  await sql`
    update purchase_orders
    set
      requested_item_count = (
        select count(*)::int
        from purchase_order_items
        where purchase_order_id = ${order.id}
      ),
      updated_at = now()
    where id = ${order.id}
  `;

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
    actualPrice?: string;
    note?: string;
    supplier?: string;
    deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
    clearActualPrice?: boolean;
    confirmStoreFeedback?: boolean;
    historyCorrection?: boolean;
    correctRequestedQuantity?: boolean;
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
      coalesce(purchase_order_items.temporary_product_name, '') as "currentTemporaryProductName",
      purchase_orders.order_no as "orderNo",
      purchase_orders.store_id::text as "storeId",
      stores.name as "storeName",
      coalesce(nullif(purchase_order_items.temporary_product_name, ''), products.name, '臨時購入品') as "productName",
      coalesce(products.reference_price::float, 0) as "referencePrice",
      purchase_order_items.status as "currentStatus",
      coalesce(purchase_order_items.procurement_note, '') as "currentNote",
      coalesce(purchase_order_items.procurement_note, '') like ${`${additionalPurchaseNotePrefix}%`} as "isAdditionalPurchase",
      purchase_order_items.store_feedback_confirmed_at is not null as "storeFeedbackConfirmed",
      purchase_order_items.requested_quantity::float as "requestedQuantity",
      purchase_order_items.requested_unit as "requestedUnit",
      coalesce(
        purchase_order_items.actual_quantity::float,
        purchase_actuals.actual_quantity::float,
        purchase_order_items.requested_quantity::float
      ) as "currentActualQuantity",
      coalesce(
        purchase_order_items.actual_price::float,
        purchase_actuals.actual_price::float
      ) as "currentActualPrice"
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    join stores on stores.id = purchase_orders.store_id
    left join products on products.id = purchase_order_items.product_id
    left join lateral (
      select
        purchase_actuals.actual_quantity,
        purchase_actuals.actual_price
      from purchase_actuals
      where purchase_actuals.purchase_order_item_id = purchase_order_items.id
      order by purchase_actuals.recorded_at desc
      limit 1
    ) purchase_actuals on true
    where purchase_order_items.id = ${body.itemId}
    limit 1
  `;
  const itemDetail = detailRows[0];

  const currentStatus = String(itemDetail?.currentStatus ?? "");
  const isDeliveryLocked = ["in_delivery", "delivered", "received"].includes(currentStatus);
  const isHistoryCorrection = body.historyCorrection === true;
  if (isHistoryCorrection && !["owner", "manager"].includes(session.role)) {
    return Response.json({ error: "履歴修正の権限がありません。" }, { status: 403 });
  }
  const requestedDeliveryStatus = String(body.deliveryStatus ?? "");
  const actualQuantity = Number.isFinite(body.actualQuantity) ? body.actualQuantity : null;
  const requestedQuantity = isHistoryCorrection && body.correctRequestedQuantity === true && Number.isFinite(body.requestedQuantity)
    ? Math.max(0, Number(body.requestedQuantity))
    : null;
  const hasActualPrice = body.actualPrice !== undefined || body.clearActualPrice === true;
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
  if (
    isDeliveryLocked &&
    !isHistoryCorrection &&
    (body.purchased === false || body.unavailable === true || requestedDeliveryStatus === "pending" || productActuallyChanged)
  ) {
    return Response.json({ error: "配送中または納品済みの商品は未配送に戻せません。" }, { status: 409 });
  }
  const shouldClearPriceException = body.purchased !== undefined || hasActualPrice || hasNote;
  const shouldResetStoreFeedbackConfirmation =
    body.confirmStoreFeedback !== true &&
    !isHistoryCorrection &&
    ((hasNote && note !== itemDetail?.currentNote) || (body.unavailable === true && itemDetail?.currentStatus !== "unavailable"));
  const deliveryStatus = ["in_delivery", "delivered", "received"].includes(body.deliveryStatus ?? "")
    ? body.deliveryStatus
    : null;
  const supplierName = String(body.supplier ?? "").trim();
  const supplierRows = supplierName
    ? await sql`
        select id
        from suppliers
        where name = ${supplierName}
        limit 1
      `
    : [];
  const supplierId = supplierRows[0]?.id ?? null;

  if (supplierName && !supplierId) {
    return Response.json({ error: "発注先が見つかりません。" }, { status: 400 });
  }

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

  if (body.purchased === false || body.unavailable === true) {
    await sql`
      delete from delivery_batch_items
      where purchase_order_item_id = ${body.itemId}
    `;
  }

  if (itemDetail) {
    if (body.clearActualPrice === true) {
      const currentActualPrice = Number(itemDetail.currentActualPrice ?? 0);
      const referencePrice = Number(itemDetail.referencePrice ?? 0);
      if (currentActualPrice > 0 && referencePrice > 0 && currentActualPrice !== referencePrice) {
        const diffRate = Math.round(((currentActualPrice - referencePrice) / referencePrice) * 1000) / 10;
        await sql`
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
            'price',
            ${`実際 ¥${formatPriceForMessage(currentActualPrice)} / 基準 ¥${formatPriceForMessage(referencePrice)} (${diffRate > 0 ? "+" : ""}${diffRate}%)`},
            '店舗確認済み',
            true,
            false,
            'resolved',
            ${session.id},
            now(),
            now()
          )
        `;
      }
    }

    if (body.unavailable === true && itemDetail.currentStatus !== "unavailable") {
      await sql`
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
      `;
    } else if (body.unavailable === true && itemDetail.currentStatus === "unavailable") {
      await sql`
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
      `;
    }

    if (body.confirmStoreFeedback === true) {
      if (itemDetail.currentStatus === "unavailable") {
        await sql`
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
            ${`${itemDetail.productName} は本依頼で購入不可として店舗確認済みです。${itemDetail.currentNote ? ` 理由: ${itemDetail.currentNote}` : ""}`},
            '店舗確認済み',
            true,
            true,
            'resolved',
            ${session.id},
            now(),
            now()
          )
        `;
      } else if (itemDetail.currentNote) {
        await sql`
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
            'note',
            ${itemDetail.currentNote},
            '店舗確認済み',
            true,
            false,
            'resolved',
            ${session.id},
            now(),
            now()
          )
        `;
      }
    }
  }

  await sql`
    update purchase_order_items
    set
      status = case
        when ${body.unavailable === true} then 'unavailable'
        when ${body.unavailable === false && itemDetail?.currentStatus === "unavailable"} then 'requested'
        when ${body.purchased === false} then 'requested'
        when ${deliveryStatus}::text is not null then ${deliveryStatus}
        when status in ('in_delivery', 'delivered', 'received') then status
        when ${body.purchased === true} then 'purchased'
        else status
      end,
      requested_quantity = case
        when ${requestedQuantity}::numeric is not null and ${requestedQuantity}::numeric > 0 then ${requestedQuantity}
        else requested_quantity
      end,
      actual_quantity = coalesce(${actualQuantity}, actual_quantity),
      actual_price = case
        when ${body.unavailable === true} then null
        when ${hasActualPrice} then ${body.clearActualPrice === true ? null : Number.isFinite(actualPrice) ? actualPrice : null}
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
      selected_supplier_id = coalesce(${supplierId}, ${productActuallyChanged ? nextProduct?.mainSupplierId ?? null : null}, selected_supplier_id),
      store_feedback_confirmed_at = case
        when ${body.confirmStoreFeedback === true} then now()
        when ${shouldResetStoreFeedbackConfirmation} then null
        else store_feedback_confirmed_at
      end,
      store_feedback_confirmed_by = case
        when ${body.confirmStoreFeedback === true} then ${session.id}
        when ${shouldResetStoreFeedbackConfirmation} then null
        else store_feedback_confirmed_by
      end
    where id = ${body.itemId}
  `;

  if (
    deliveryStatus === "delivered" &&
    itemDetail &&
    !itemDetail.isAdditionalPurchase &&
    !["delivered", "received"].includes(String(itemDetail.currentStatus ?? ""))
  ) {
    await sql`
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
    `;
  }

  if (body.clearActualPrice === true) {
    await sql`
      update purchase_actuals
      set
        actual_price = null,
        price_is_exception = false
      where purchase_order_item_id = ${body.itemId}
    `;

    await sql`
      delete from price_records
      where source = 'purchase_actual'
        and receipt_note = ${body.itemId}
    `;
  }

  if (body.purchased === false || body.unavailable === true) {
    await sql`
      delete from purchase_actuals
      where purchase_order_item_id = ${body.itemId}
    `;

    await sql`
      delete from price_records
      where source = 'purchase_actual'
        and receipt_note = ${body.itemId}
    `;
  }

  if (body.purchased && body.unavailable !== true) {
    await sql`
      delete from purchase_actuals
      where purchase_order_item_id = ${body.itemId}
    `;

    await sql`
      insert into purchase_actuals (
        purchase_order_item_id,
        supplier_id,
        actual_quantity,
        actual_unit,
        actual_price,
        price_is_exception,
        note
      )
      select
        purchase_order_items.id,
        coalesce(${supplierId}, purchase_order_items.selected_supplier_id),
        coalesce(${actualQuantity}, purchase_order_items.requested_quantity),
        purchase_order_items.requested_unit,
        ${Number.isFinite(actualPrice) ? actualPrice : null},
        false,
        ${note}
      from purchase_order_items
      where purchase_order_items.id = ${body.itemId}
    `;

    if (Number.isFinite(actualPrice)) {
      await sql`
        delete from price_records
        where source = 'purchase_actual'
          and receipt_note = ${body.itemId}
      `;

      await sql`
        insert into price_records (
          product_id,
          supplier_id,
          price,
          unit,
          source,
          receipt_note,
          recorded_by
        )
        select
          purchase_order_items.product_id,
          coalesce(${supplierId}, purchase_order_items.selected_supplier_id),
          ${actualPrice},
          purchase_order_items.requested_unit,
          'purchase_actual',
          ${body.itemId},
          ${session.id}
        from purchase_order_items
        where purchase_order_items.id = ${body.itemId}
          and purchase_order_items.product_id is not null
      `;
    }
  }

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
    select purchase_order_id as "purchaseOrderId"
    from purchase_order_items
    where id = ${itemId}
    limit 1
  `;
  const purchaseOrderId = itemRows[0]?.purchaseOrderId;

  if (!purchaseOrderId) {
    return Response.json({ error: "発注明細が見つかりません。" }, { status: 404 });
  }

  await sql`
    delete from purchase_order_items
    where id = ${itemId}
  `;

  await sql`
    update purchase_orders
    set
      requested_item_count = (
        select count(*)::int
        from purchase_order_items
        where purchase_order_id = ${purchaseOrderId}
      ),
      updated_at = now()
    where id = ${purchaseOrderId}
  `;

  return Response.json({ ok: true });
}

function formatPriceForMessage(value: number) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}
