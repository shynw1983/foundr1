import { sql } from "./db";

export async function getProcurementDashboardData() {
  const [stores, brands, products, suppliers, supplierLocations, productBrandUsages, productSupplierOptions] =
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
      `
    ]);

  return {
    stores,
    brands,
    products,
    suppliers,
    supplierLocations,
    productBrandUsages,
    productSupplierOptions
  };
}
