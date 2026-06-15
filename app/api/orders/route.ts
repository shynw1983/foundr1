import { canAccessStore, getSessionStoreScope, requireOsSession, requireWritableOsSession } from "../../../lib/api-auth";
import type { EmployeeSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";
import { sendPurchaseOrderLarkNotification } from "../../../lib/lark";
import { roleHasPermission } from "../../../lib/role-permissions";

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

async function validateOrderInput(session: EmployeeSession, storeName: string, productNames: string[], productIds: string[]) {
  if (!storeName) {
    return { error: Response.json({ error: "納品先店舗を選択してください。" }, { status: 400 }) };
  }

  if (productNames.length === 0) {
    return { error: Response.json({ error: "商品を1件以上選択してください。" }, { status: 400 }) };
  }

  const stores = await sql`
    select id
    from stores
    where name = ${storeName}
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

  return { storeId, productIdsByName, validProductIds };
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
  const orderNo = `PO-${new Date().toISOString().slice(5, 10).replace("-", "")}-${Date.now().toString().slice(-3)}`;
  const validation = await validateOrderInput(session, storeName, productNames, productIds);
  if (validation.error) return validation.error;
  const requesterStaffId = await validateStaffAssignee(session, requesterStaffIdInput, validation.storeId, session.id);
  const buyerStaffId = await validateStaffAssignee(session, buyerStaffIdInput, validation.storeId, requesterStaffId);

  const insertedOrders = await sql`
    insert into purchase_orders (
      order_no,
      store_id,
      deadline_label,
      deadline_at,
      requested_item_count,
      priority,
      status,
      note,
      requested_by,
      assigned_to
    )
    values (
      ${orderNo},
      ${validation.storeId},
      ${deadline},
      ${deadlineAt},
      ${itemCount},
      ${priority},
      ${"購入待ち"},
      ${note},
      ${requesterStaffId},
      ${buyerStaffId}
    )
    returning id
  `;

  const purchaseOrderId = insertedOrders[0]?.id;

  if (purchaseOrderId) {
    for (const [index, productName] of productNames.entries()) {
      const quantity = normalizeRequestedQuantity(quantities[index]);
      const unit = units[index] || "個";
      const productId = productIds[index] || validation.productIdsByName?.get(productName);

      await sql`
        insert into purchase_order_items (
          purchase_order_id,
          product_id,
          requested_quantity,
          requested_unit,
          status
        )
        values (
          ${purchaseOrderId},
          ${productId},
          ${quantity},
          ${unit},
        ${"requested"}
      )
    `;
    }

    await notifyBuyerAboutOrder({
      buyerStaffId,
      orderNo,
      storeName,
      itemCount,
      deadline
    });
  }

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
        status in ('purchased', 'in_delivery', 'delivered')
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

  const updatedOrders = await sql`
    update purchase_orders
    set
      store_id = ${validation.storeId},
      deadline_label = ${deadline},
      deadline_at = ${deadlineAt},
      requested_item_count = ${productNames.length},
      priority = ${priority},
      note = ${note},
      requested_by = ${requesterStaffId},
      assigned_to = ${buyerStaffId},
      updated_at = now()
    where purchase_orders.id = ${purchaseOrderId}
    returning purchase_orders.id
  `;

  if (!updatedOrders[0]?.id) {
    return Response.json({ error: "納品先店舗が見つかりません。" }, { status: 400 });
  }

  await sql`
    delete from purchase_order_items
    where purchase_order_id = ${purchaseOrderId}
  `;

  for (const [index, productName] of productNames.entries()) {
    const quantity = normalizeRequestedQuantity(quantities[index]);
    const unit = units[index] || "個";
    const productId = productIds[index] || validation.productIdsByName?.get(productName);

    await sql`
      insert into purchase_order_items (
        purchase_order_id,
        product_id,
        requested_quantity,
        requested_unit,
        status
      )
      values (
        ${purchaseOrderId},
        ${productId},
        ${quantity},
        ${unit},
        ${"requested"}
      )
    `;
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
    select store_id::text as "storeId"
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

  await sql`
    delete from purchase_orders
    where order_no = ${body.orderId}
  `;

  return Response.json({ ok: true });
}
