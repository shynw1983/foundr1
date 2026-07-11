import { sql } from "./db";

export async function getActiveDiningSessionsForPos(storeId: string) {
  if (!storeId) return [];
  return sql`
    select
      store_dining_sessions.id::text,
      store_dining_sessions.table_group_label as label,
      store_dining_sessions.status,
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
      and store_dining_sessions.status in ('selecting', 'cooking', 'dining')
    group by store_dining_sessions.id
    order by
      case store_dining_sessions.status when 'selecting' then 0 when 'cooking' then 1 else 2 end,
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
}) {
  const rows = await sql`
    with target_session as (
      select id, table_group_label
      from store_dining_sessions
      where id::text = ${input.sessionId}
        and store_id::text = ${input.storeId}
        and status in ('selecting', 'cooking', 'dining')
    ), linked as (
      insert into store_dining_session_orders (session_id, order_id)
      select target_session.id, ${input.orderId}
      from target_session
      on conflict (order_id) do nothing
      returning session_id
    ), advanced as (
      update store_dining_sessions
      set status = 'cooking', paid_at = coalesce(paid_at, now()), updated_at = now()
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
    set status = 'dining', served_at = coalesce(served_at, now()), updated_at = now()
    where id in (
      select store_dining_session_orders.session_id
      from store_dining_session_orders
      where store_dining_session_orders.order_id::text = ${orderId}
    )
      and status in ('selecting', 'cooking', 'dining')
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
