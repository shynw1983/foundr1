import { sql } from "./db";

export async function getProcurementDashboardData() {
  const [
    stores,
    brands,
    products,
    suppliers,
    supplierLocations,
    productBrandUsages,
    productSupplierOptions,
    orders,
    purchaseOrderItems,
    deliveryBatches
  ] =
    await Promise.all([
      sql`
        select
          stores.name,
          stores.owner_name as owner,
          coalesce(array_agg(brands.name order by brands.name) filter (where brands.name is not null), '{}') as brands
        from stores
        left join store_brands on store_brands.store_id = stores.id
        left join brands on brands.id = store_brands.brand_id
        group by stores.id
        order by stores.name
      `,
      sql`select name, brand_type as type from brands order by name`,
      sql`
        select
          name,
          category,
          unit,
          reference_price::float as "referencePrice",
          coalesce(spec_note, '') as "specNote",
          coalesce(storage_type, '') as "storageType",
          coalesce(photo_url, '') as "photoUrl",
          coalesce((
            select suppliers.name
            from product_supplier_options
            join suppliers on suppliers.id = product_supplier_options.supplier_id
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = 'メイン'
              and product_supplier_options.is_active = true
            order by suppliers.name
            limit 1
          ), '') as "mainSupplier",
          coalesce((
            select suppliers.name
            from product_supplier_options
            join suppliers on suppliers.id = product_supplier_options.supplier_id
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = '予備'
              and product_supplier_options.is_active = true
            order by suppliers.name
            limit 1
          ), '') as "backupSupplier",
          case
            when exists (
              select 1 from product_brand_usages
              join brands on brands.id = product_brand_usages.brand_id
              where product_brand_usages.product_id = products.id
            )
            then (
              select string_agg(brands.name, ' / ' order by brands.name)
              from product_brand_usages
              join brands on brands.id = product_brand_usages.brand_id
              where product_brand_usages.product_id = products.id
            )
            else '共通'
          end as brand
        from products
        order by name
      `,
      sql`
        select name, category, reliability, channel_type as "channelType"
        from suppliers
        order by name
      `,
      sql`
        select
          suppliers.name as supplier,
          supplier_locations.name as "locationName",
          supplier_locations.location_type as type,
          supplier_locations.area,
          supplier_locations.opening_hours as hours,
          supplier_locations.purchase_method as "purchaseMethod",
          supplier_locations.note
        from supplier_locations
        join suppliers on suppliers.id = supplier_locations.supplier_id
        order by suppliers.name, supplier_locations.name
      `,
      sql`
        select
          products.name as product,
          brands.name as brand,
          product_brand_usages.usage_note as usage,
          product_brand_usages.default_order_quantity as "defaultOrderQuantity",
          product_brand_usages.spec_note as "specNote",
          product_brand_usages.priority
        from product_brand_usages
        join products on products.id = product_brand_usages.product_id
        join brands on brands.id = product_brand_usages.brand_id
        order by products.name, brands.name
      `,
      sql`
        select
          products.name as product,
          json_agg(
            json_build_object(
              'supplier', suppliers.name,
              'role', product_supplier_options.role,
              'referencePrice', product_supplier_options.reference_price::float,
              'minOrder', product_supplier_options.min_order_quantity,
              'leadTime', product_supplier_options.lead_time,
              'note', product_supplier_options.note
            )
            order by
              case product_supplier_options.role
                when 'メイン' then 1
                when '予備' then 2
                when '緊急' then 3
                else 9
              end,
              suppliers.name
          ) as options
        from product_supplier_options
        join products on products.id = product_supplier_options.product_id
        join suppliers on suppliers.id = product_supplier_options.supplier_id
        where product_supplier_options.is_active = true
        group by products.name
        order by products.name
      `,
      sql`
        select
          purchase_orders.order_no as id,
          stores.name as store,
          coalesce(order_brands.brand_names, brands.name, '共通') as brand,
          coalesce(purchase_orders.deadline_label, '') as deadline,
          purchase_orders.requested_item_count as items,
          purchase_orders.priority,
          coalesce(purchase_orders.note, '') as note,
          case
            when order_progress.total_count is null or order_progress.total_count = 0 then purchase_orders.status
            when order_progress.delivered_count = order_progress.total_count then '完了'
            when order_progress.in_delivery_count > 0 then '配送中'
            when order_progress.delivered_count > 0 then '一部配達済み'
            when order_progress.purchased_count = 0 then '仕入れ待ち'
            when order_progress.purchased_count < order_progress.total_count then '一部完了'
            else '配送待ち'
          end as status
        from purchase_orders
        join stores on stores.id = purchase_orders.store_id
        left join brands on brands.id = purchase_orders.brand_id
        left join lateral (
          select string_agg(distinct brands.name, ' / ' order by brands.name) as brand_names
          from purchase_order_items
          join brands on brands.id = purchase_order_items.brand_id
          where purchase_order_items.purchase_order_id = purchase_orders.id
        ) order_brands on true
        left join lateral (
          select
            count(purchase_order_items.id)::int as total_count,
            count(purchase_order_items.id) filter (
              where purchase_order_items.status in ('purchased', 'in_delivery', 'delivered')
                or exists (
                  select 1
                  from purchase_actuals
                  where purchase_actuals.purchase_order_item_id = purchase_order_items.id
                )
            )::int as purchased_count,
            count(purchase_order_items.id) filter (where purchase_order_items.status = 'in_delivery')::int as in_delivery_count,
            count(purchase_order_items.id) filter (where purchase_order_items.status = 'delivered')::int as delivered_count
          from purchase_order_items
          where purchase_order_items.purchase_order_id = purchase_orders.id
        ) order_progress on true
        order by purchase_orders.created_at desc
      `,
      sql`
        select
          purchase_order_items.id::text as id,
          purchase_orders.order_no as "orderId",
          products.name as "productName",
          coalesce(item_brands.name, order_brands.name, '共通') as "brandName",
          purchase_order_items.requested_quantity::float as "requestedQuantity",
          purchase_order_items.requested_unit as unit,
          coalesce(
            purchase_order_items.actual_quantity::float,
            purchase_actuals.actual_quantity::float,
            purchase_order_items.requested_quantity::float
          ) as "actualQuantity",
          (
            purchase_order_items.status in ('purchased', 'in_delivery', 'delivered')
            or purchase_actuals.id is not null
          ) as purchased,
          case
            when purchase_order_items.status = 'in_delivery' then 'in_delivery'
            when purchase_order_items.status = 'delivered' then 'delivered'
            else 'pending'
          end as "deliveryStatus",
          delivery_batch_items.delivery_batch_id::text as "deliveryBatchId",
          case
            when purchase_order_items.note like 'supplier=%'
            then split_part(split_part(purchase_order_items.note, ';', 1), '=', 2)
            else ''
          end as supplier,
          case
            when purchase_order_items.procurement_note is not null
            then purchase_order_items.procurement_note
            when purchase_order_items.note like '%note=%'
            then split_part(purchase_order_items.note, 'note=', 2)
            else coalesce(purchase_actuals.note, '')
          end as note,
          case
            when purchase_order_items.price_exception_note is not null
            then purchase_order_items.price_exception_note
            when purchase_actuals.price_is_exception
            then coalesce(purchase_actuals.note, '')
            else ''
          end as "priceExceptionNote"
        from purchase_order_items
        join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
        join products on products.id = purchase_order_items.product_id
        left join brands item_brands on item_brands.id = purchase_order_items.brand_id
        left join brands order_brands on order_brands.id = purchase_orders.brand_id
        left join lateral (
          select
            purchase_actuals.id,
            purchase_actuals.actual_quantity,
            purchase_actuals.note,
            purchase_actuals.price_is_exception
          from purchase_actuals
          where purchase_actuals.purchase_order_item_id = purchase_order_items.id
          order by purchase_actuals.recorded_at desc
          limit 1
        ) purchase_actuals on true
        left join delivery_batch_items on delivery_batch_items.purchase_order_item_id = purchase_order_items.id
        order by purchase_orders.created_at desc, purchase_order_items.id
      `,
      sql`
        select
          delivery_batches.id::text as id,
          purchase_orders.order_no as "orderId",
          delivery_batches.batch_no as "batchNo",
          delivery_batches.status,
          to_char(delivery_batches.created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "createdLabel",
          coalesce(array_agg(delivery_batch_items.purchase_order_item_id::text order by delivery_batch_items.purchase_order_item_id), '{}') as "itemIds"
        from delivery_batches
        join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
        left join delivery_batch_items on delivery_batch_items.delivery_batch_id = delivery_batches.id
        group by delivery_batches.id, purchase_orders.order_no
        order by delivery_batches.created_at desc
      `
    ]);

  return {
    stores,
    brands,
    products,
    suppliers,
    supplierLocations,
    productBrandUsages,
    productSupplierOptions,
    orders,
    purchaseOrderItems,
    deliveryBatches
  };
}
