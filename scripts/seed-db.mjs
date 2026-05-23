import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";
import {
  brands,
  orders,
  productBrandUsages,
  products,
  productSupplierOptions,
  stores,
  supplierLocations,
  suppliers
} from "../lib/mock-data.ts";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

for (const brand of brands) {
  await sql`
    insert into brands (name, brand_type, updated_at)
    values (${brand.name}, ${brand.type}, now())
    on conflict (name)
    do update set brand_type = excluded.brand_type, updated_at = now()
  `;
}

for (const store of stores) {
  await sql`
    insert into stores (name, owner_name, updated_at)
    values (${store.name}, ${store.owner}, now())
    on conflict (name)
    do update set owner_name = excluded.owner_name, updated_at = now()
  `;

  for (const brandName of store.brands) {
    await sql`
      insert into store_brands (store_id, brand_id)
      select stores.id, brands.id
      from stores, brands
      where stores.name = ${store.name}
        and brands.name = ${brandName}
      on conflict do nothing
    `;
  }
}

for (const product of products) {
  await sql`
    insert into products (name, category, unit, reference_price, is_key_item, is_price_sensitive, updated_at)
    values (
      ${product.name},
      ${product.category},
      ${product.unit},
      ${product.referencePrice},
      ${product.category === "食材"},
      ${product.category === "食材"},
      now()
    )
    on conflict (name)
    do update set
      category = excluded.category,
      unit = excluded.unit,
      reference_price = excluded.reference_price,
      is_key_item = excluded.is_key_item,
      is_price_sensitive = excluded.is_price_sensitive,
      updated_at = now()
  `;
}

for (const usage of productBrandUsages) {
  await sql`
    insert into product_brand_usages (
      product_id,
      brand_id,
      usage_note,
      default_order_quantity,
      spec_note,
      priority
    )
    select products.id, brands.id, ${usage.usage}, ${usage.defaultOrderQuantity}, ${usage.specNote}, ${usage.priority}
    from products, brands
    where products.name = ${usage.product}
      and brands.name = ${usage.brand}
    on conflict (product_id, brand_id)
    do update set
      usage_note = excluded.usage_note,
      default_order_quantity = excluded.default_order_quantity,
      spec_note = excluded.spec_note,
      priority = excluded.priority
  `;
}

for (const supplier of suppliers) {
  await sql`
    insert into suppliers (name, category, channel_type, reliability, updated_at)
    values (${supplier.name}, ${supplier.category}, ${supplier.channelType}, ${supplier.reliability}, now())
    on conflict (name)
    do update set
      category = excluded.category,
      channel_type = excluded.channel_type,
      reliability = excluded.reliability,
      updated_at = now()
  `;
}

for (const location of supplierLocations) {
  await sql`
    insert into supplier_locations (
      supplier_id,
      name,
      location_type,
      area,
      opening_hours,
      purchase_method,
      supports_delivery,
      supports_urgent_purchase,
      note
    )
    select
      suppliers.id,
      ${location.locationName},
      ${location.type},
      ${location.area},
      ${location.hours},
      ${location.purchaseMethod},
      ${location.purchaseMethod.includes("配送")},
      ${location.type === "チェーン店"},
      ${location.note}
    from suppliers
    where suppliers.name = ${location.supplier}
    on conflict (supplier_id, name)
    do update set
      location_type = excluded.location_type,
      area = excluded.area,
      opening_hours = excluded.opening_hours,
      purchase_method = excluded.purchase_method,
      supports_delivery = excluded.supports_delivery,
      supports_urgent_purchase = excluded.supports_urgent_purchase,
      note = excluded.note
  `;
}

for (const group of productSupplierOptions) {
  for (const option of group.options) {
    await sql`
      insert into product_supplier_options (
        product_id,
        supplier_id,
        role,
        reference_price,
        min_order_quantity,
        lead_time,
        note
      )
      select
        products.id,
        suppliers.id,
        ${option.role},
        ${option.referencePrice},
        ${option.minOrder},
        ${option.leadTime},
        ${option.note}
      from products, suppliers
      where products.name = ${group.product}
        and suppliers.name = ${option.supplier}
      on conflict (product_id, supplier_id, role)
      do update set
        reference_price = excluded.reference_price,
        min_order_quantity = excluded.min_order_quantity,
        lead_time = excluded.lead_time,
        note = excluded.note,
        is_active = true
    `;
  }
}

for (const order of orders) {
  await sql`
    insert into purchase_orders (
      order_no,
      store_id,
      brand_id,
      deadline_label,
      requested_item_count,
      priority,
      status
    )
    select
      ${order.id},
      stores.id,
      brands.id,
      ${order.deadline},
      ${order.items},
      ${order.priority},
      ${order.status}
    from stores, brands
    where stores.name = ${order.store}
      and brands.name = ${order.brand.includes("/") ? order.brand.split(" / ")[0] : order.brand}
    on conflict (order_no)
    do update set
      deadline_label = excluded.deadline_label,
      requested_item_count = excluded.requested_item_count,
      priority = excluded.priority,
      status = excluded.status,
      updated_at = now()
  `;
}

const counts = await sql`
  select
    (select count(*) from stores) as stores,
    (select count(*) from brands) as brands,
    (select count(*) from products) as products,
    (select count(*) from product_brand_usages) as product_brand_usages,
    (select count(*) from suppliers) as suppliers,
    (select count(*) from supplier_locations) as supplier_locations,
    (select count(*) from product_supplier_options) as product_supplier_options,
    (select count(*) from purchase_orders) as purchase_orders
`;

console.log(JSON.stringify(counts[0], null, 2));
