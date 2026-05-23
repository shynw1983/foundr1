import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const suppliers = ["業務スーパー", "百旬館", "友誼商店"];
const stores = ["清水店納品", "清川店納品", "共通納品"];
const brandName = "共通";

const orders = [
  {
    orderNo: "PO-20260523-GS-SHIMIZU",
    store: "清水店納品",
    supplier: "業務スーパー",
    items: [
      { name: "カマンベールチーズ", quantity: 3, unit: "個" },
      { name: "うずらの卵缶入2個、袋入10個（袋２）", quantity: 1, unit: "式" },
      { name: "個包装割り箸", quantity: 3, unit: "袋" },
      { name: "冷凍さつまいもスティック", quantity: 6, unit: "袋" },
      { name: "えのき", quantity: 10, unit: "個" },
      { name: "しめじ", quantity: 10, unit: "個" },
      { name: "エリンギ", quantity: 5, unit: "個" },
      { name: "しいたけ", quantity: 2, unit: "個" },
      { name: "プチトマト", quantity: 1, unit: "袋" }
    ]
  },
  {
    orderNo: "PO-20260523-GS-KIYOKAWA",
    store: "清川店納品",
    supplier: "業務スーパー",
    items: [
      { name: "黒糖", quantity: 2, unit: "袋" },
      { name: "きび和糖", quantity: 2, unit: "袋" },
      { name: "白砂糖", quantity: 6, unit: "袋" },
      { name: "柚子茶", quantity: 1, unit: "缶" },
      { name: "クリープ", quantity: 4, unit: "袋" },
      { name: "桃缶", quantity: 2, unit: "個" },
      { name: "国産きなこ粉末", quantity: 2, unit: "袋" }
    ]
  },
  {
    orderNo: "PO-20260523-HYAKUJUNKAN",
    store: "共通納品",
    supplier: "百旬館",
    items: [
      { name: "個包装スプーン16cm", quantity: 4, unit: "袋", note: "原文: 5袋4袋" },
      { name: "カマンベールチーズ", quantity: 3, unit: "個" },
      { name: "いいだこ", quantity: 2, unit: "袋", note: "ベトナム産1キロ入。冷凍ヤリイカ横の冷凍庫にあれば" },
      { name: "姫たけのこ（細たけのこ）", quantity: 1, unit: "袋" },
      { name: "ウインナー", quantity: 1, unit: "袋" }
    ]
  },
  {
    orderNo: "PO-20260523-YOUYI",
    store: "共通納品",
    supplier: "友誼商店",
    items: [
      { name: "蟹団子", quantity: 5, unit: "袋", note: "特に必要" },
      { name: "えび団子", quantity: 1, unit: "袋" },
      { name: "牛団子", quantity: 1, unit: "袋" },
      { name: "冷凍生腐竹", quantity: 2, unit: "袋" }
    ]
  }
];

function inferCategory(name) {
  if (name.includes("割り箸") || name.includes("スプーン")) return "消耗品";
  return "食材";
}

function inferStorageType(name) {
  if (name.includes("冷凍") || name.includes("いいだこ") || name.includes("団子") || name.includes("腐竹")) return "冷凍";
  if (name.includes("チーズ") || name.includes("えのき") || name.includes("しめじ") || name.includes("エリンギ") || name.includes("しいたけ") || name.includes("トマト")) return "冷蔵";
  return "常温";
}

await sql`
  insert into brands (name, brand_type, updated_at)
  values (${brandName}, ${"共通"}, now())
  on conflict (name)
  do update set brand_type = excluded.brand_type, updated_at = now()
`;

for (const supplier of suppliers) {
  await sql`
    insert into suppliers (name, category, channel_type, reliability, updated_at)
    values (${supplier}, ${"20260523 実購買テスト"}, ${"実店舗"}, ${"テスト登録"}, now())
    on conflict (name)
    do update set
      category = excluded.category,
      channel_type = excluded.channel_type,
      reliability = excluded.reliability,
      updated_at = now()
  `;
}

for (const store of stores) {
  await sql`
    insert into stores (name, owner_name, updated_at)
    values (${store}, ${"20260523 テスト"}, now())
    on conflict (name)
    do update set owner_name = excluded.owner_name, updated_at = now()
  `;
}

for (const order of orders) {
  for (const item of order.items) {
    await sql`
      insert into products (
        name,
        category,
        unit,
        reference_price,
        spec_note,
        storage_type,
        is_key_item,
        is_price_sensitive,
        updated_at
      )
      values (
        ${item.name},
        ${inferCategory(item.name)},
        ${item.unit},
        ${0},
        ${item.note ?? ""},
        ${inferStorageType(item.name)},
        ${inferCategory(item.name) === "食材"},
        ${inferCategory(item.name) === "食材"},
        now()
      )
      on conflict (name)
      do update set
        category = excluded.category,
        unit = excluded.unit,
        spec_note = coalesce(nullif(excluded.spec_note, ''), products.spec_note),
        storage_type = excluded.storage_type,
        is_key_item = excluded.is_key_item,
        is_price_sensitive = excluded.is_price_sensitive,
        updated_at = now()
    `;

    await sql`
      insert into product_supplier_options (
        product_id,
        supplier_id,
        role,
        reference_price,
        min_order_quantity,
        lead_time,
        note,
        is_active
      )
      select
        products.id,
        suppliers.id,
        ${"メイン"},
        ${0},
        ${`${item.quantity} ${item.unit}`},
        ${"当日"},
        ${"20260523 実購買テスト"},
        true
      from products, suppliers
      where products.name = ${item.name}
        and suppliers.name = ${order.supplier}
      on conflict (product_id, supplier_id, role)
      do update set
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
      status,
      note,
      created_at,
      updated_at
    )
    select
      ${order.orderNo},
      stores.id,
      brands.id,
      ${"2026-05-23"},
      ${order.items.length},
      ${order.items.some((item) => item.note?.includes("特に必要")) ? "高" : "中"},
      ${"仕入れ待ち"},
      ${`${order.supplier} / 20260523 実購買テスト`},
      ${"2026-05-23T09:00:00+09:00"},
      now()
    from stores, brands
    where stores.name = ${order.store}
      and brands.name = ${brandName}
    on conflict (order_no)
    do update set
      store_id = excluded.store_id,
      brand_id = excluded.brand_id,
      deadline_label = excluded.deadline_label,
      requested_item_count = excluded.requested_item_count,
      priority = excluded.priority,
      status = excluded.status,
      note = excluded.note,
      updated_at = now()
  `;

  await sql`
    delete from purchase_order_items
    using purchase_orders
    where purchase_order_items.purchase_order_id = purchase_orders.id
      and purchase_orders.order_no = ${order.orderNo}
  `;

  for (const item of order.items) {
    const noteParts = [`supplier=${order.supplier}`];
    if (item.note) noteParts.push(`note=${item.note}`);

    const insertedItems = await sql`
      insert into purchase_order_items (
        purchase_order_id,
        product_id,
        requested_quantity,
        requested_unit,
        note,
        status
      )
      select
        purchase_orders.id,
        products.id,
        ${item.quantity},
        ${item.unit},
        ${noteParts.join(";")},
        ${"requested"}
      from purchase_orders, products
      where purchase_orders.order_no = ${order.orderNo}
        and products.name = ${item.name}
      returning id
    `;

    const purchaseOrderItemId = insertedItems[0]?.id;

    if (purchaseOrderItemId) {
      await sql`
        delete from purchase_actuals
        where purchase_order_item_id = ${purchaseOrderItemId}
      `;
    }
  }
}

const rows = await sql`
  select
    purchase_orders.order_no,
    purchase_orders.status,
    count(purchase_order_items.id)::int as items
  from purchase_orders
  join purchase_order_items on purchase_order_items.purchase_order_id = purchase_orders.id
  where purchase_orders.order_no like 'PO-20260523-%'
  group by purchase_orders.order_no, purchase_orders.status
  order by purchase_orders.order_no
`;

console.log(JSON.stringify(rows, null, 2));
