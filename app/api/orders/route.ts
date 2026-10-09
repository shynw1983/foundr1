import { canAccessStore, getSessionStoreScope, requireOsSession, requireWritableOsSession } from "../../../lib/api-auth";
import type { EmployeeSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";
import { sendPurchaseOrderLarkNotification } from "../../../lib/lark";
import { publishOsNotificationEvent } from "../../../lib/notification-realtime";
import { roleHasPermission } from "../../../lib/role-permissions";
import { assertProductsOrderable } from "../../../lib/product-catalog-access";
import { openReplenishmentOrderStatuses, readReplenishmentOrderContext, readReplenishmentOrderIntent, validateReplenishmentOrderSubmission } from "../../../lib/replenishment-order-intent";
import { createReplenishmentOrderLocks, isReplenishmentOrderGuardConflict } from "../../../lib/replenishment-order-locks";

function toTokyoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
    day: parts.find((part) => part.type === "day")?.value ?? ""
  };
}

function formatDeadlineLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute] = match;
  const today = toTokyoDateParts(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = toTokyoDateParts(tomorrowDate);

  if (today.year === year && today.month === month && today.day === day) {
    return `本日 ${hour}:${minute}`;
  }

  if (tomorrow.year === year && tomorrow.month === month && tomorrow.day === day) {
    return `明日 ${hour}:${minute}`;
  }

  return `${month}/${day} ${hour}:${minute}`;
}

function deadlineAtFromInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:00+09:00`;
}

function normalizeRequestedQuantity(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(999, Math.max(1, Math.round(value)));
}

async function validateOrderInput(session: EmployeeSession, storeName: string, productNames: string[], productIds: string[], explicitStoreId?: string) {
  if (!storeName) {
    return { error: Response.json({ error: "納品先店舗を選択してください。" }, { status: 400 }) };
  }

  if (productNames.length === 0) {
    return { error: Response.json({ error: "商品を1件以上選択してください。" }, { status: 400 }) };
  }

  const stores = await sql`
    select id
    from stores
    where (${Boolean(explicitStoreId)} and id::text = ${explicitStoreId ?? ""})
      or (${!explicitStoreId} and name = ${storeName})
    limit 1
  `;
  const storeId = stores[0]?.id as string | undefined;

  if (!storeId) {
    return { error: Response.json({ error: "納品先店舗が見つかりません。" }, { status: 400 }) };
  }

  if (!await canAccessStore(session, storeId)) {
    return { error: Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 }) };
  }

  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueProductIds.length > 0 && (productIds.length !== productNames.length || productIds.some((id) => !id))) {
    return { error: Response.json({ error: "画面を更新して、すべての商品IDを確認してください。" }, { status: 409 }) };
  }
  const productRows = uniqueProductIds.length > 0
    ? await sql`
    select id, name
    from products
    where id::text = any(${uniqueProductIds})
  `
    : await sql`
    select id, name
    from products
    where name = any(${Array.from(new Set(productNames))})
  `;
  if (uniqueProductIds.length === 0 && new Set(productRows.map((row) => String(row.name))).size !== productRows.length) {
    return { error: Response.json({ error: "同名の商品が複数あります。商品IDを指定して発注してください。" }, { status: 409 }) };
  }
  const productIdsByName = new Map(productRows.map((row) => [String(row.name), String(row.id)]));
  const validProductIds = new Set(productRows.map((row) => String(row.id)));
  const missingProducts = uniqueProductIds.length > 0
    ? productIds.filter((id) => id && !validProductIds.has(id))
    : productNames.filter((name) => !productIdsByName.has(name));

  if (missingProducts.length > 0) {
    return {
      error: Response.json(
        { error: `商品マスタに存在しない商品があります: ${Array.from(new Set(missingProducts)).join("、")}` },
        { status: 400 }
      )
    };
  }

  const access = await assertProductsOrderable(session, storeId, [...validProductIds]);
  if (!access.ok) return { error: Response.json({ error: access.error }, { status: access.status }) };
  return { storeId, productIdsByName, validProductIds };
}

async function getCurrentOpenItems(storeId: string, productIds: string[]) {
  const rows = await sql`
    select items.id::text as "itemId", items.product_id::text as "productId",
      orders.order_no as "orderId", items.status,
      items.requested_quantity as "requestedQuantity", items.requested_unit as "requestedUnit"
    from purchase_order_items items
    join purchase_orders orders on orders.id = items.purchase_order_id
    where orders.store_id::text = ${storeId}
      and items.product_id::text = any(${productIds})
      and items.status = any(${[...openReplenishmentOrderStatuses]})
      and orders.order_no not like 'RCPT-%'
    order by items.id
  `;
  return rows.map((row) => ({ ...row, requestedQuantity: Number(row.requestedQuantity), href: `/os/orders?order=${encodeURIComponent(String(row.orderId))}` }));
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!await roleHasPermission(session.role, "module.orders")) return Response.json({ error: "発注依頼を表示する権限がありません。" }, { status: 403 });
  const parsed = readReplenishmentOrderIntent(new URL(request.url).searchParams);
  if (!parsed.intent) return Response.json({ error: parsed.error ?? "店舗と商品を指定してください。" }, { status: 400 });
  const { storeId, productIds } = parsed.intent;
  const access = await assertProductsOrderable(session, storeId, productIds);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const openItems = await getCurrentOpenItems(storeId, productIds);
  return Response.json({
    storeId, productIds, openItems,
    canCreateOrder: ["owner", "manager", "store_owner", "store_manager", "staff"].includes(session.role)
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function validateStaffAssignee(session: EmployeeSession, staffId: string, storeId: string, fallbackId: string) {
  const targetStaffId = staffId || fallbackId;
  const scope = await getSessionStoreScope(session);
  const rows = await sql`
    select employees.id::text as id
    from employees
    left join employee_scopes
      on employee_scopes.employee_id = employees.id
      and employee_scopes.scope_type = 'store'
    where employees.id = ${targetStaffId}
      and employees.status = 'active'
      and (
        ${scope.allStores}
        or employees.id = ${session.id}
        or employee_scopes.store_id = ${storeId}
      )
    limit 1
  `;

  return rows[0]?.id ? targetStaffId : fallbackId;
}

async function notifyBuyerAboutOrder({
  buyerStaffId,
  orderNo,
  storeName,
  itemCount,
  deadline
}: {
  buyerStaffId: string;
  orderNo: string;
  storeName: string;
  itemCount: number;
  deadline: string;
}) {
  const href = `/os/procurement?order=${encodeURIComponent(orderNo)}`;
  const title = "新しい発注依頼";
  const message = `${storeName} から ${itemCount} 件の発注依頼が届きました。`;
  const insertedNotifications = await sql`
    insert into os_notifications (
      recipient_employee_id,
      notification_type,
      title,
      message,
      href
    )
    values (
      ${buyerStaffId},
      ${"new_order"},
      ${title},
      ${message},
      ${href}
    )
    returning id
  `;
  const notificationId = insertedNotifications[0]?.id;
  await publishOsNotificationEvent(buyerStaffId).catch(() => undefined);

  const buyerRows = await sql`
    select
      name,
      lark_open_id as "larkOpenId",
      lark_user_id as "larkUserId"
    from employees
    where id = ${buyerStaffId}
    limit 1
  `;
  const buyer = buyerRows[0] as { name?: string; larkOpenId?: string | null; larkUserId?: string | null } | undefined;
  const larkResult = await sendPurchaseOrderLarkNotification(
    {
      larkOpenId: buyer?.larkOpenId,
      larkUserId: buyer?.larkUserId
    },
    {
      orderNo,
      storeName,
      itemCount,
      deadline,
      buyerName: buyer?.name,
      href
    }
  );

  if (!notificationId) return;

  if (larkResult.delivered) {
    await sql`
      update os_notifications
      set lark_sent_at = now(),
          lark_error = null
      where id = ${notificationId}
    `;
  } else if (!larkResult.ok) {
    await sql`
      update os_notifications
      set lark_error = ${larkResult.error}
      where id = ${notificationId}
    `;
  }
}

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const storeName = String(formData.get("store") ?? "");
  const deadlineInput = String(formData.get("deadline") ?? "");
  const deadline = formatDeadlineLabel(deadlineInput);
  const deadlineAt = deadlineAtFromInput(deadlineInput);
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const requesterStaffIdInput = String(formData.get("requesterStaffId") ?? "");
  const buyerStaffIdInput = String(formData.get("buyerStaffId") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const productIds = formData.getAll("productId").map((value) => String(value));
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));
  const itemCount = productNames.length;
  const rawContext = formData.get("replenishContext");
  const replenishContext = rawContext === null ? null : readReplenishmentOrderContext(String(rawContext));
  if (rawContext !== null && !replenishContext) {
    return Response.json({ error: "補充対象の店舗と商品を確認して、もう一度開いてください。" }, { status: 400 });
  }
  if (replenishContext && !await roleHasPermission(session.role, "module.orders")) {
    return Response.json({ error: "補充依頼を作成する権限がありません。" }, { status: 403 });
  }
  const validation = await validateOrderInput(session, storeName, productNames, productIds, replenishContext?.storeId);
  if (validation.error) return validation.error;
  const resolvedProductIds = productNames.map((name, index) => productIds[index] || validation.productIdsByName?.get(name) || "");
  if (replenishContext) {
    const error = validateReplenishmentOrderSubmission(replenishContext, {
      storeId: validation.storeId, productIds: resolvedProductIds, quantities: formData.getAll("requestedQuantity")
    });
    if (error) return Response.json({ error }, { status: 400 });
    if (units.length !== itemCount || units.some((unit) => !unit)) {
      return Response.json({ error: "補充商品の発注単位が変わりました。最新の内容を確認してください。" }, { status: 409 });
    }
  }
  const requesterStaffId = await validateStaffAssignee(session, requesterStaffIdInput, validation.storeId, session.id);
  const buyerStaffId = await validateStaffAssignee(session, buyerStaffIdInput, validation.storeId, requesterStaffId);
  const lineData = productNames.map((_, index) => ({
    productId: resolvedProductIds[index], quantity: normalizeRequestedQuantity(quantities[index]), unit: units[index] || "個"
  }));
  const today = toTokyoDateParts(new Date());
  const prefix = `PO-${today.year}${today.month}${today.day}`;
  // Separate statements are intentional: the snapshot after a waiting advisory lock
  // sees the order committed by the first creator (including ordinary manual orders).
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${`purchase-order-number:${prefix}`}, 0))`,
    ...createReplenishmentOrderLocks(sql, [{ storeId: validation.storeId, productIds: resolvedProductIds }]),
    sql`
      with submitted as materialized (
        select * from jsonb_to_recordset(${JSON.stringify(lineData)}::jsonb)
          as line("productId" text, quantity numeric, unit text)
      ), locked_products as materialized (
        select products.* from products
        where products.id::text = any(${[...new Set(resolvedProductIds)]})
        order by products.id for share
      ), current_open as (
        select coalesce(array_agg(items.id::text order by items.id::text), '{}'::text[]) as ids
        from purchase_order_items items join purchase_orders orders on orders.id = items.purchase_order_id
        where orders.store_id::text = ${validation.storeId}
          and items.product_id::text = any(${replenishContext?.productIds ?? []})
          and items.status = any(${[...openReplenishmentOrderStatuses]})
          and orders.order_no not like 'RCPT-%'
      ), eligibility as (
        select
          (${!replenishContext} or current_open.ids = ${replenishContext?.expectedOpenItemIds ?? []}::text[]) as "openMatches",
          (${!replenishContext} or not exists (
            select 1 from submitted left join locked_products p on p.id::text = submitted."productId"
            where p.id is null or submitted.unit <> coalesce(nullif(p.unit, ''), '個')
          )) as "unitsMatch",
          not exists (
            select 1 from locked_products p
            where not p.is_orderable
              or not (p.brand_scope = 'common' or (p.brand_scope = 'specific' and exists (
                select 1 from product_brand_usages u join store_brands sb on sb.brand_id = u.brand_id
                where u.product_id = p.id and sb.store_id::text = ${validation.storeId}
              )))
              or ((p.brand_scope = 'specific' or exists (
                select 1 from product_brand_usages u join store_brands sb on sb.brand_id = u.brand_id
                where u.product_id = p.id and sb.store_id::text = ${validation.storeId}
              )) and not exists (
                select 1 from product_brand_usages u join store_brands sb on sb.brand_id = u.brand_id
                where u.product_id = p.id and sb.store_id::text = ${validation.storeId} and u.is_orderable
              ))
              or (${!["owner", "manager"].includes(session.role)} and not (
                p.catalog_visibility = 'brand_stores' or (p.catalog_visibility = 'selected_stores' and exists (
                  select 1 from product_catalog_store_grants g where g.product_id = p.id and g.store_id::text = ${validation.storeId}
                ))
              ))
          ) and (select count(*) from locked_products) = ${new Set(resolvedProductIds).size} as "catalogMatches"
        from current_open
      ), order_number as (
        select ${prefix} || '-' || lpad((coalesce(max((substring(order_no from ${`^${prefix}-([0-9]{4})$`}))::int), 0) + 1)::text, 4, '0') as value
        from purchase_orders where order_no like ${`${prefix}-%`}
      ), inserted_order as (
        insert into purchase_orders (order_no, store_id, deadline_label, deadline_at, requested_item_count,
          priority, status, note, requested_by, assigned_to, replenishment_source)
        select order_number.value, ${validation.storeId}::uuid, ${deadline}, ${deadlineAt}::timestamptz,
          ${itemCount}, ${priority}, '購入待ち', ${note}, ${requesterStaffId}::uuid, ${buyerStaffId}::uuid,
          ${replenishContext ? JSON.stringify(replenishContext) : null}::jsonb
        from order_number, eligibility
        where eligibility."openMatches" and eligibility."unitsMatch" and eligibility."catalogMatches"
        returning id, order_no
      ), inserted_items as (
        insert into purchase_order_items (purchase_order_id, product_id, requested_quantity, requested_unit, status)
        select inserted_order.id, submitted."productId"::uuid, submitted.quantity, submitted.unit, 'requested'
        from inserted_order, submitted returning id
      )
      select (select order_no from inserted_order) as "orderNo", (select count(*) from inserted_items) as "insertedCount",
        eligibility.* from eligibility
    `
  ]);
  const result = results[results.length - 1][0];
  const orderNo = result?.orderNo as string | undefined;
  if (!orderNo) {
    const error = result?.catalogMatches === false
      ? "商品の公開範囲または発注可否が変わりました。最新の内容を確認してください。"
      : result?.unitsMatch === false
        ? "補充商品の発注単位が変わりました。最新の内容を確認してください。"
        : "未受領の発注が変わりました。元の発注を確認して、追加の補充が必要か確認してください。";
    return Response.json({ error }, { status: 409 });
  }
  await notifyBuyerAboutOrder({ buyerStaffId, orderNo, storeName, itemCount, deadline })
    .catch(() => console.error("purchase_order_notification_failed"));
  return Response.json({ ok: true, orderId: orderNo });
}

export async function PUT(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "");
  const storeName = String(formData.get("store") ?? "");
  const deadlineInput = String(formData.get("deadline") ?? "");
  const deadline = formatDeadlineLabel(deadlineInput);
  const deadlineAt = deadlineAtFromInput(deadlineInput);
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const requesterStaffIdInput = String(formData.get("requesterStaffId") ?? "");
  const buyerStaffIdInput = String(formData.get("buyerStaffId") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const productIds = formData.getAll("productId").map((value) => String(value));
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));

  if (!orderId) {
    return Response.json({ error: "依頼番号が必要です。" }, { status: 400 });
  }

  if (productNames.length === 0) {
    return Response.json({ error: "商品を1件以上選択してください。" }, { status: 400 });
  }

  const validation = await validateOrderInput(session, storeName, productNames, productIds);
  if (validation.error) return validation.error;
  const requesterStaffId = await validateStaffAssignee(session, requesterStaffIdInput, validation.storeId, session.id);
  const buyerStaffId = await validateStaffAssignee(session, buyerStaffIdInput, validation.storeId, requesterStaffId);

  const existingOrder = await sql`
    select
      id,
      store_id::text as "storeId",
      assigned_to::text as "assignedTo"
    from purchase_orders
    where order_no = ${orderId}
    limit 1
  `;
  const purchaseOrderId = existingOrder[0]?.id;

  if (!purchaseOrderId) {
    return Response.json({ error: "発注依頼が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, existingOrder[0]?.storeId)) {
    return Response.json({ error: "この依頼を操作する権限がありません。" }, { status: 403 });
  }

  const lockedItems = await sql`
    select count(*)::int as count
    from purchase_order_items
    where purchase_order_id = ${purchaseOrderId}
      and (
        status in ('purchased', 'in_delivery', 'delivered', 'received')
        or exists (
          select 1
          from purchase_actuals
          where purchase_actuals.purchase_order_item_id = purchase_order_items.id
        )
      )
  `;

  if (Number(lockedItems[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "発注処理が始まっている依頼は編集できません。必要な変更は備考または追加依頼で対応してください。" },
      { status: 409 }
    );
  }

  const previousItems = await sql`
    select id::text as id, product_id::text as "productId"
    from purchase_order_items where purchase_order_id = ${purchaseOrderId}
    order by id
  `;
  const resolvedProductIds = productNames.map((name, index) => productIds[index] || validation.productIdsByName?.get(name) || "");
  const sourceStoreId = String(existingOrder[0].storeId);
  try {
    await sql.transaction([
      ...createReplenishmentOrderLocks(sql, [
        { storeId: sourceStoreId, productIds: previousItems.map((item) => item.productId) },
        { storeId: validation.storeId, productIds: resolvedProductIds }
      ], String(purchaseOrderId)),
      sql`select id from purchase_orders where id = ${purchaseOrderId} for update`,
      sql`select id from purchase_order_items where purchase_order_id = ${purchaseOrderId} order by id for update`,
      // Re-read after all locks: do not erase an appended SKU or an item that started buying.
      sql`
        select 1 / count(*)::int from purchase_orders
        where id = ${purchaseOrderId} and store_id::text = ${sourceStoreId}
          and coalesce((select jsonb_agg(jsonb_build_array(id::text, product_id::text) order by id)
            from purchase_order_items where purchase_order_id = ${purchaseOrderId}), '[]'::jsonb)
            = ${JSON.stringify(previousItems.map((item) => [item.id, item.productId]))}::jsonb
          and not exists (
            select 1 from purchase_order_items items where items.purchase_order_id = ${purchaseOrderId}
              and (items.status in ('purchased', 'in_delivery', 'delivered', 'received')
                or exists (select 1 from purchase_actuals where purchase_order_item_id = items.id))
          )
      `,
      sql`
        update purchase_orders set store_id = ${validation.storeId}, deadline_label = ${deadline}, deadline_at = ${deadlineAt},
          requested_item_count = ${productNames.length}, priority = ${priority}, note = ${note},
          requested_by = ${requesterStaffId}, assigned_to = ${buyerStaffId}, updated_at = now()
        where id = ${purchaseOrderId}
      `,
      sql`delete from purchase_order_items where purchase_order_id = ${purchaseOrderId}`,
      ...productNames.map((_, index) => sql`
        insert into purchase_order_items (purchase_order_id, product_id, requested_quantity, requested_unit, status)
        values (${purchaseOrderId}, ${resolvedProductIds[index]}, ${normalizeRequestedQuantity(quantities[index])}, ${units[index] || "個"}, 'requested')
      `)
    ]);
  } catch (error) {
    if (!isReplenishmentOrderGuardConflict(error)) throw error;
    return Response.json({ error: "発注処理が始まっている依頼は編集できません。必要な変更は備考または追加依頼で対応してください。" }, { status: 409 });
  }

  if (String(existingOrder[0]?.assignedTo ?? "") !== buyerStaffId) {
    await notifyBuyerAboutOrder({
      buyerStaffId,
      orderNo: orderId,
      storeName,
      itemCount: productNames.length,
      deadline
    });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!(await roleHasPermission(session.role, "history.delete"))) {
    return Response.json({ error: "履歴削除の権限がありません。" }, { status: 403 });
  }

  const body = await request.json() as { orderId?: string };

  if (!body.orderId) {
    return Response.json({ error: "orderId is required" }, { status: 400 });
  }

  const existingOrder = await sql`
    select id::text as id, store_id::text as "storeId"
    from purchase_orders
    where order_no = ${body.orderId}
    limit 1
  `;

  if (!existingOrder[0]) {
    return Response.json({ error: "発注依頼が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, existingOrder[0]?.storeId)) {
    return Response.json({ error: "この依頼を操作する権限がありません。" }, { status: 403 });
  }

  try {
    await sql.transaction([
      ...createReplenishmentOrderLocks(sql, [], String(existingOrder[0].id)),
      sql`select id from purchase_orders where id = ${existingOrder[0].id}::uuid for update`,
      sql`select 1 / case when exists (
        select 1 from inventory_stock_receipts receipts
        join purchase_order_items items on items.id = receipts.purchase_order_item_id
        where items.purchase_order_id = ${existingOrder[0].id}::uuid
      ) then 0 else 1 end`,
      sql`delete from purchase_orders where id = ${existingOrder[0].id}::uuid`
    ]);
  } catch (error) {
    if (!isReplenishmentOrderGuardConflict(error) && !(error && typeof error === "object" && "code" in error && (error.code === "23503" || error.code === "23001"))) throw error;
    return Response.json({ error: "入庫履歴がある発注依頼は削除できません。" }, { status: 409 });
  }

  return Response.json({ ok: true });
}
