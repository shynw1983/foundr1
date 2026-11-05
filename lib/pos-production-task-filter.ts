import { posImmediateItemSql, posOrderHasPreparationSql, posPreparationItemSql } from './pos-item-fulfillment';

function alias(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Invalid internal SQL alias');
  return value;
}

/** A task is relevant only while it still represents a non-refunded preparation line.
 * Brand-group tasks have no item ID; immediate products cannot keep such a group alive. */
export function posPreparationTaskSql(orderAlias: string, taskAlias: string): string {
  const o = alias(orderAlias), t = alias(taskAlias);
  return `((${t}.order_item_id is not null and exists (
    select 1 from store_customer_order_items preparation_task_item
    where preparation_task_item.id=${t}.order_item_id and preparation_task_item.order_id=${o}.id
      and coalesce(preparation_task_item.refund_status,'')<>'refunded'
      and ${posPreparationItemSql(o, 'preparation_task_item')}
  )) or (${t}.order_item_id is null and exists (
    select 1 from store_customer_order_items preparation_group_item
    left join menu_catalog_items preparation_group_menu on preparation_group_menu.id=preparation_group_item.menu_catalog_item_id
    where preparation_group_item.order_id=${o}.id and coalesce(preparation_group_item.refund_status,'')<>'refunded'
      and ${posPreparationItemSql(o, 'preparation_group_item')}
      and ((not coalesce((${o}.order_source='store_pos' and ${o}.customer_summary->'posItemFulfillment'->'version'='1'::jsonb),false))
        or coalesce(preparation_group_item.pickup_code,'')='')
      and (${t}.brand_id is null or coalesce(preparation_group_menu.brand_id,${o}.brand_id)=${t}.brand_id)
  )))`;
}

/** Legacy orders without structured items keep their existing fallback display behavior. */
export function posOrderHasPreparationOrLegacySql(orderAlias: string): string {
  const o = alias(orderAlias);
  return `((not coalesce((${o}.order_source='store_pos' and ${o}.customer_summary->'posItemFulfillment'->'version'='1'::jsonb),false))
    or ${posOrderHasPreparationSql(o)})`;
}

/** Refund of every preparation line can finish a sale whose remaining goods were handed over at checkout. */
export function posOrderHasActiveImmediateSql(orderAlias: string): string {
  const o = alias(orderAlias);
  return `exists(select 1 from store_customer_order_items immediate_remaining_item
    where immediate_remaining_item.order_id=${o}.id and immediate_remaining_item.refund_status<>'refunded'
      and ${posImmediateItemSql(o, 'immediate_remaining_item')})`;
}
