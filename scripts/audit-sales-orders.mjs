import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const strict = process.argv.includes("--strict");
const sql = neon(process.env.DATABASE_URL);

const [summary] = await sql`
  with customer as (
    select id, order_source, status, payment_status, amount
    from store_customer_orders
  ),
  synced as (
    select source_order_id, channel, source_platform, status, payment_status, total
    from sales_orders
    where source_order_id is not null
  ),
  joined as (
    select
      c.id,
      c.order_source,
      c.status as customer_status,
      s.status as sales_status,
      c.payment_status as customer_payment_status,
      s.payment_status as sales_payment_status,
      c.amount as customer_amount,
      s.total as sales_total,
      s.source_order_id
    from customer c
    left join synced s on s.source_order_id = c.id
  )
  select
    (select count(*)::int from customer) as customer_orders,
    (select count(*)::int from synced) as synced_sales_orders,
    count(*) filter (where source_order_id is null)::int as missing_sales_orders,
    count(*) filter (where source_order_id is not null and customer_amount <> sales_total)::int as amount_mismatches,
    count(*) filter (where source_order_id is not null and customer_status <> sales_status)::int as status_mismatches,
    count(*) filter (where source_order_id is not null and customer_payment_status <> sales_payment_status)::int as payment_status_mismatches
  from joined
`;

const bySource = await sql`
  with joined as (
    select
      coalesce(c.order_source, s.source_platform, s.channel, 'unknown') as source,
      c.id as customer_id,
      s.id as sales_id
    from store_customer_orders c
    full join sales_orders s on s.source_order_id = c.id
    where c.id is not null or s.source_order_id is not null
  )
  select
    source,
    count(customer_id)::int as customer_orders,
    count(sales_id)::int as sales_orders,
    count(customer_id) filter (where sales_id is null)::int as missing_sales_orders
  from joined
  group by source
  order by source
`;

const [itemSummary] = await sql`
  with customer_items as (
    select
      order_id,
      count(*)::int as item_count,
      coalesce(sum(amount), 0)::int as item_total
    from store_customer_order_items
    group by order_id
  ),
  sales_items as (
    select
      sales_orders.source_order_id as order_id,
      count(sales_order_items.id)::int as item_count,
      coalesce(sum(sales_order_items.line_total), 0)::int as item_total
    from sales_orders
    left join sales_order_items on sales_order_items.sales_order_id = sales_orders.id
    where sales_orders.source_order_id is not null
    group by sales_orders.source_order_id
  )
  select
    count(*) filter (where sales_items.order_id is null)::int as missing_item_sync_orders,
    count(*) filter (where sales_items.order_id is not null and customer_items.item_count <> sales_items.item_count)::int as item_count_mismatches,
    count(*) filter (where sales_items.order_id is not null and customer_items.item_total <> sales_items.item_total)::int as item_total_mismatches
  from customer_items
  left join sales_items on sales_items.order_id = customer_items.order_id
`;

const orphanSalesOrders = await sql`
  select
    sales_orders.channel,
    sales_orders.source_platform,
    sales_orders.status,
    sales_orders.payment_status,
    count(*)::int as orders,
    coalesce(sum(sales_orders.total), 0)::int as total
  from sales_orders
  left join store_customer_orders on store_customer_orders.id = sales_orders.source_order_id
  where sales_orders.source_order_id is not null
    and store_customer_orders.id is null
  group by sales_orders.channel, sales_orders.source_platform, sales_orders.status, sales_orders.payment_status
  order by orders desc, sales_orders.source_platform
`;

const externalOnlySalesOrders = await sql`
  select
    channel,
    source_platform,
    count(*)::int as orders,
    coalesce(sum(total), 0)::int as total
  from sales_orders
  where source_order_id is null
  group by channel, source_platform
  order by orders desc, source_platform
`;

const dependencyCounts = await sql`
  select 'loyalty_point_ledger' as dependency, count(*)::int as rows from loyalty_point_ledger where order_id is not null
  union all select 'loyalty_stamp_ledger', count(*)::int from loyalty_stamp_ledger where order_id is not null
  union all select 'member_coupons_used', count(*)::int from member_coupons where used_order_id is not null
  union all select 'loyalty_settlement_entries', count(*)::int from loyalty_settlement_entries where order_id is not null
  union all select 'pos_order_corrections', count(*)::int from pos_order_corrections
  union all select 'store_customer_order_items', count(*)::int from store_customer_order_items
  union all select 'order_production_tasks', count(*)::int from order_production_tasks
  union all select 'pos_orders_with_cash_session', count(*)::int from store_customer_orders where pos_cash_session_id is not null
`;

const report = {
  checkedAt: new Date().toISOString(),
  summary,
  bySource,
  itemSummary,
  orphanSalesOrders,
  externalOnlySalesOrders,
  dependencyCounts
};

console.log(JSON.stringify(report, null, 2));

const hasSyncProblems = [
  summary.missing_sales_orders,
  summary.amount_mismatches,
  summary.status_mismatches,
  summary.payment_status_mismatches,
  itemSummary.missing_item_sync_orders,
  itemSummary.item_count_mismatches,
  itemSummary.item_total_mismatches
].some((value) => Number(value) > 0);

if (strict && (hasSyncProblems || orphanSalesOrders.length > 0)) {
  process.exitCode = 1;
}
