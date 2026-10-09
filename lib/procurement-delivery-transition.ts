/** Batch and item statuses change together. Retries never move a received item backwards. */
export function createDeliveryBatchTransitionQuery<T>(
  query: (parts: TemplateStringsArray, ...values: any[]) => T,
  input: { batchId: string; storeId: string; status: "delivered" | "received"; employeeId: string }
) {
  return query`
    with locked_batch as materialized (
      select batches.id, batches.purchase_order_id, batches.status as previous_status
      from delivery_batches batches
      join purchase_orders orders on orders.id = batches.purchase_order_id
      where batches.id = ${input.batchId}::uuid and orders.store_id = ${input.storeId}::uuid
      for update of batches
    ), eligible as (
      select * from locked_batch
      where (
        (${input.status} = 'received' and previous_status in ('delivered', 'received'))
        or (${input.status} = 'delivered' and previous_status in ('in_delivery', 'delivered', 'received'))
      )
      and exists (select 1 from delivery_batch_items where delivery_batch_id = locked_batch.id)
      and not exists (
        select 1 from delivery_batch_items links
        join purchase_order_items items on items.id = links.purchase_order_item_id
        where links.delivery_batch_id = locked_batch.id
          and (items.purchase_order_id <> locked_batch.purchase_order_id
            or items.status not in ('in_delivery', 'delivered', 'received')
            or (${input.status} = 'received' and items.status = 'in_delivery'))
      )
    ), transitioned as (
      update delivery_batches batches
      set status = case when eligible.previous_status = 'received' then 'received' else ${input.status} end,
        delivered_at = case when eligible.previous_status = 'in_delivery' and ${input.status} = 'delivered'
          then now() else batches.delivered_at end,
        store_confirmed_at = case when eligible.previous_status = 'delivered' and ${input.status} = 'received'
          then now() else batches.store_confirmed_at end,
        store_confirmed_by = case when eligible.previous_status = 'delivered' and ${input.status} = 'received'
          then ${input.employeeId}::uuid else batches.store_confirmed_by end
      from eligible where batches.id = eligible.id
      returning batches.id, batches.purchase_order_id, batches.status, eligible.previous_status
    ), transitioned_items as (
      update purchase_order_items items
      set status = case when items.status = 'received' then 'received' else transitioned.status end
      from delivery_batch_items links, transitioned
      where links.delivery_batch_id = transitioned.id and links.purchase_order_item_id = items.id
      returning items.id
    )
    select purchase_order_id::text as "purchaseOrderId", status,
      previous_status <> status as changed,
      (select count(*) from transitioned_items)::int as "itemCount"
    from transitioned
  `;
}
