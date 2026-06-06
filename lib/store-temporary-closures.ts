import { sql } from "./db";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function toTokyoTimestamp(date: string, time: string) {
  return `${date} ${time}:00+09`;
}

export async function getTemporaryClosureForPickup(storeId: string, pickupDate: string, pickupTime: string) {
  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      starts_at::text as "startsAt",
      ends_at::text as "endsAt",
      reason,
      public_message as "publicMessage",
      status
    from store_temporary_closures
    where store_id::text = ${storeId}
      and status = 'active'
      and ${toTokyoTimestamp(pickupDate, pickupTime)}::timestamptz >= starts_at
      and ${toTokyoTimestamp(pickupDate, pickupTime)}::timestamptz < ends_at
    order by starts_at
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getUpcomingTemporaryClosures(storeId: string) {
  return sql`
    select
      id::text,
      starts_at::text as "startsAt",
      ends_at::text as "endsAt",
      reason,
      public_message as "publicMessage",
      status
    from store_temporary_closures
    where store_id::text = ${storeId}
      and status = 'active'
      and ends_at >= now()
    order by starts_at
    limit 20
  `;
}

export async function getAffectedOrdersForTemporaryClosures(storeId: string) {
  return sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.customer_summary #>> '{customer,name}', store_customer_orders.customer_summary ->> 'name', '') as "customerName",
      coalesce(store_customer_orders.customer_summary #>> '{customer,phone}', store_customer_orders.customer_summary ->> 'phone', '') as "customerPhone",
      store_temporary_closures.id::text as "closureId",
      store_temporary_closures.reason,
      store_temporary_closures.public_message as "publicMessage"
    from store_customer_orders
    join store_temporary_closures
      on store_temporary_closures.store_id = store_customer_orders.store_id
      and store_temporary_closures.status = 'active'
      and ((store_customer_orders.pickup_date::text || ' ' || store_customer_orders.pickup_time || ':00+09')::timestamptz) >= store_temporary_closures.starts_at
      and ((store_customer_orders.pickup_date::text || ' ' || store_customer_orders.pickup_time || ':00+09')::timestamptz) < store_temporary_closures.ends_at
    where store_customer_orders.store_id::text = ${storeId}
      and store_customer_orders.status not in ('cancelled', 'payment_failed', 'checkout_failed')
      and store_customer_orders.payment_status not in ('refunded', 'failed', 'canceled')
      and ((store_customer_orders.pickup_date::text || ' ' || store_customer_orders.pickup_time || ':00+09')::timestamptz) >= now()
    order by store_customer_orders.pickup_date, store_customer_orders.pickup_time
    limit 100
  `;
}

export async function createTemporaryClosure(input: {
  storeId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason?: string;
  publicMessage?: string;
  createdBy?: string;
}) {
  const storeId = normalizeText(input.storeId);
  const date = normalizeText(input.date);
  const startTime = normalizeText(input.startTime);
  const endTime = normalizeText(input.endTime);
  if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error("休業日と時間を入力してください。");
  }
  if (endTime <= startTime) {
    throw new Error("終了時間は開始時間より後にしてください。");
  }
  const rows = await sql`
    insert into store_temporary_closures (
      store_id,
      starts_at,
      ends_at,
      reason,
      public_message,
      created_by,
      updated_at
    )
    values (
      ${storeId},
      ${toTokyoTimestamp(date, startTime)}::timestamptz,
      ${toTokyoTimestamp(date, endTime)}::timestamptz,
      ${normalizeText(input.reason)},
      ${normalizeText(input.publicMessage)},
      nullif(${normalizeText(input.createdBy)}, '')::uuid,
      now()
    )
    returning id::text
  `;
  return rows[0] ?? null;
}

export async function cancelTemporaryClosure(input: { storeId: string; closureId: string }) {
  const rows = await sql`
    update store_temporary_closures
    set status = 'cancelled', updated_at = now()
    where id::text = ${input.closureId}
      and store_id::text = ${input.storeId}
      and status = 'active'
    returning id::text
  `;
  return rows[0] ?? null;
}
