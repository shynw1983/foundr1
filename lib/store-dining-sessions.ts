import { sql } from "./db";

export async function getActiveDiningSessionsForPos(storeId: string) {
  if (!storeId) return [];
  return sql`
    select
      store_dining_sessions.id::text,
      store_dining_sessions.table_group_label as label,
      case
        when store_dining_sessions.status = 'dining' then 'dining'
        when store_dining_sessions.order_status = 'cooking' then 'cooking'
        else 'selecting'
      end as status,
      store_dining_sessions.status as "occupancyStatus",
      store_dining_sessions.order_status as "orderStatus",
      store_dining_sessions.dine_in_entitled as "dineInEntitled",
      store_dining_sessions.party_size::int as "partySize",
      count(distinct store_dining_session_orders.order_id)::int as "orderCount",
      to_char(store_dining_sessions.assigned_at at time zone 'Asia/Tokyo', 'HH24:MI') as "assignedAt"
    from store_dining_sessions
    join store_dining_session_tables
      on store_dining_session_tables.session_id = store_dining_sessions.id
      and store_dining_session_tables.released_at is null
    left join store_dining_session_orders
      on store_dining_session_orders.session_id = store_dining_sessions.id
    where store_dining_sessions.store_id::text = ${storeId}
      and store_dining_sessions.status in ('seated', 'dining')
    group by store_dining_sessions.id
    order by
      case store_dining_sessions.order_status when 'selecting' then 0 when 'cooking' then 1 else 2 end,
      store_dining_sessions.assigned_at,
      store_dining_sessions.table_group_label
  `;
}

export async function storeRequiresDiningSeat(storeId: string) {
  if (!storeId) return false;
  const rows = await sql`
    select exists(
      select 1 from store_floor_layouts where store_id::text = ${storeId}
    ) as required
  `;
  return rows[0]?.required === true;
}

export async function linkPaidOrderToDiningSession(input: {
  storeId: string;
  sessionId: string;
  orderId: string;
  grantsDineInEntitlement: boolean;
}) {
  const rows = await sql`
    with target_session as (
      select id, table_group_label
      from store_dining_sessions
      where id::text = ${input.sessionId}
        and store_id::text = ${input.storeId}
        and status in ('seated', 'dining')
        and (dine_in_entitled = true or ${input.grantsDineInEntitlement})
    ), linked as (
      insert into store_dining_session_orders (session_id, order_id)
      select target_session.id, ${input.orderId}
      from target_session
      on conflict (order_id) do nothing
      returning session_id
    ), advanced as (
      update store_dining_sessions
      set
        order_status = 'cooking',
        dine_in_entitled = dine_in_entitled or ${input.grantsDineInEntitlement},
        paid_at = coalesce(paid_at, now()),
        updated_at = now()
      where id in (select session_id from linked)
      returning id
    )
    update store_customer_orders
    set
      store_table_id = coalesce(store_table_id, (
        select store_dining_session_tables.table_id
        from store_dining_session_tables
        join store_tables on store_tables.id = store_dining_session_tables.table_id
        where store_dining_session_tables.session_id in (select id from advanced)
        order by store_tables.sort_order, store_tables.label
        limit 1
      )),
      customer_summary = customer_summary || jsonb_build_object(
        'diningSessionId', ${input.sessionId},
        'diningSeatLabel', (select table_group_label from target_session limit 1)
      ),
      updated_at = now()
    where id::text = ${input.orderId}
      and store_id::text = ${input.storeId}
      and exists (select 1 from advanced)
    returning id::text
  `;
  return Boolean(rows[0]?.id);
}

export async function syncDiningSessionFromProduction(orderId: string) {
  if (!orderId) return false;
  const rows = await sql`
    update store_dining_sessions
    set status = 'dining', order_status = 'idle', served_at = coalesce(served_at, now()), updated_at = now()
    where id in (
      select store_dining_session_orders.session_id
      from store_dining_session_orders
      where store_dining_session_orders.order_id::text = ${orderId}
    )
      and status in ('seated', 'dining')
      and exists (
        select 1
        from store_dining_session_orders
        join order_production_tasks on order_production_tasks.order_id = store_dining_session_orders.order_id
        where store_dining_session_orders.session_id = store_dining_sessions.id
      )
      and not exists (
        select 1
        from store_dining_session_orders
        join order_production_tasks on order_production_tasks.order_id = store_dining_session_orders.order_id
        where store_dining_session_orders.session_id = store_dining_sessions.id
          and order_production_tasks.status <> 'ready'
      )
    returning id::text
  `;
  return Boolean(rows[0]?.id);
}

export async function linkTableOrderToDiningSession(input: { storeId: string; sessionId: string; orderId: string }) {
  const rows = await sql`
    with target_session as (
      select id, table_group_label
      from store_dining_sessions
      where id::text = ${input.sessionId}
        and store_id::text = ${input.storeId}
        and status in ('seated', 'dining')
    ), linked as (
      insert into store_dining_session_orders (session_id, order_id)
      select id, ${input.orderId} from target_session
      on conflict (order_id) do nothing
      returning session_id
    )
    update store_customer_orders
    set customer_summary = customer_summary || jsonb_build_object(
      'diningSessionId', ${input.sessionId},
      'diningSeatLabel', (select table_group_label from target_session limit 1)
    )
    where id::text = ${input.orderId}
      and exists (select 1 from linked)
    returning id::text
  `;
  return Boolean(rows[0]?.id);
}

export async function markDiningOrdersPaid(orderIds: string[]) {
  if (!orderIds.length) return;
  await sql`
    update store_dining_sessions
    set
      order_status = 'cooking',
      dine_in_entitled = dine_in_entitled or exists (
        select 1
        from store_dining_session_orders
        join store_customer_order_items on store_customer_order_items.order_id = store_dining_session_orders.order_id
        join menu_catalog_items on menu_catalog_items.id = store_customer_order_items.menu_catalog_item_id
        join brands on brands.id = menu_catalog_items.brand_id
        where store_dining_session_orders.session_id = store_dining_sessions.id
          and store_dining_session_orders.order_id::text = any(${orderIds})
          and (lower(brands.name) like '%maamaa%' or brands.name like '%まぁ麻%' or brands.name like '%麻辣%')
      ),
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
    where id in (
      select session_id from store_dining_session_orders where order_id::text = any(${orderIds})
    )
      and status in ('seated', 'dining')
  `;
}
