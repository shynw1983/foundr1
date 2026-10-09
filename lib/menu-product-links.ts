import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { MenuProductLinksError, normalizeMenuProductIds, normalizeMenuProductLinkTarget, type MenuProductLinkKind } from "./menu-product-link-policy";

export type MenuLinkedProduct = { id: string; name: string; unit: string };
export type MenuProductLinksResponse = {
  target: { kind: MenuProductLinkKind; id: string; name: string; brandId: string; isActive: boolean };
  products: MenuLinkedProduct[];
  productIds: string[];
  availableProducts: MenuLinkedProduct[];
};

export async function readMenuProductLinks(kindInput: unknown, targetIdInput: unknown): Promise<MenuProductLinksResponse> {
  const { kind, targetId } = normalizeMenuProductLinkTarget(kindInput, targetIdInput);
  const targets = await sql`
    select id::text, name, brand_id::text as "brandId", is_active as "isActive", store_id is null as canonical
    from menu_catalog_items where ${kind === "item"} and id::text = ${targetId}
    union all
    select options.id::text, options.name, groups.brand_id::text as "brandId",
      options.is_active and groups.is_active and coalesce(parent.is_active, true) as "isActive", (groups.menu_catalog_item_id is null or parent.store_id is null) as canonical
    from menu_options options join menu_option_groups groups on groups.id = options.option_group_id
    left join menu_catalog_items parent on parent.id = groups.menu_catalog_item_id
    where ${kind === "option"} and options.id::text = ${targetId}
  `;
  const target = targets[0];
  if (!target) throw new MenuProductLinksError("対象メニューが見つかりません。", 404);
  if (target.canonical !== true) throw new MenuProductLinksError("共通メニューの商品・選択肢を選択してください。");
  const [products, availableProducts] = await Promise.all([
    sql`
      select products.id::text, products.name, products.unit
      from menu_product_links links join products on products.id = links.product_id
      where (${kind === "item"} and links.menu_catalog_item_id::text = ${targetId})
        or (${kind === "option"} and links.menu_option_id::text = ${targetId})
      order by products.name, products.id
    `,
    sql`
      select products.id::text, products.name, products.unit
      from products
      where products.brand_scope = 'common' or (products.brand_scope = 'specific' and exists (
        select 1 from product_brand_usages usage where usage.product_id = products.id and usage.brand_id::text = ${String(target.brandId)}
      ))
      order by products.name, products.id
    `
  ]);
  const toProduct = (row: Record<string, unknown>): MenuLinkedProduct => ({ id: String(row.id), name: String(row.name), unit: String(row.unit) });
  const linkedProducts = products.map(toProduct);
  return {
    target: { kind, id: String(target.id), name: String(target.name), brandId: String(target.brandId), isActive: target.isActive === true },
    products: linkedProducts,
    productIds: linkedProducts.map((product) => product.id).sort(),
    availableProducts: availableProducts.map(toProduct)
  };
}

export async function replaceMenuProductLinks(session: EmployeeSession, body: Record<string, unknown>): Promise<MenuProductLinksResponse> {
  const { kind, targetId } = normalizeMenuProductLinkTarget(body.kind, body.targetId);
  const productIds = normalizeMenuProductIds(body.productIds);
  const expectedProductIds = normalizeMenuProductIds(body.expectedProductIds);
  // The lock has its own statement so the following statement gets a fresh READ COMMITTED snapshot after a concurrent save finishes.
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${`menu-product-links:${kind}:${targetId}`}, 0))`,
    sql`
      with target as materialized (
        select id, brand_id, is_active, store_id is null as canonical from menu_catalog_items
        where ${kind === "item"} and id::text = ${targetId}
        union all
        select options.id, groups.brand_id, options.is_active and groups.is_active and coalesce(parent.is_active, true),
          (groups.menu_catalog_item_id is null or parent.store_id is null) as canonical
        from menu_options options join menu_option_groups groups on groups.id = options.option_group_id
        left join menu_catalog_items parent on parent.id = groups.menu_catalog_item_id
        where ${kind === "option"} and options.id::text = ${targetId}
      ), current_links as materialized (
        select coalesce(array_agg(product_id::text order by product_id::text), '{}'::text[]) as ids
        from menu_product_links
        where (${kind === "item"} and menu_catalog_item_id::text = ${targetId})
          or (${kind === "option"} and menu_option_id::text = ${targetId})
      ), requested_products as materialized (
        select products.id from products cross join target
        where products.id::text = any(${productIds}) and (products.brand_scope = 'common' or (
          products.brand_scope = 'specific' and exists (
            select 1 from product_brand_usages usage where usage.product_id = products.id and usage.brand_id = target.brand_id
          )
        ))
      ), eligible as materialized (
        select target.id from target cross join current_links
        where target.is_active and target.canonical and current_links.ids = ${expectedProductIds}::text[]
          and (select count(*) from requested_products) = ${productIds.length}
      ), removed as (
        delete from menu_product_links where exists(select 1 from eligible)
          and ((${kind === "item"} and menu_catalog_item_id::text = ${targetId}) or (${kind === "option"} and menu_option_id::text = ${targetId}))
          and product_id::text <> all(${productIds}) returning id
      ), inserted as (
        insert into menu_product_links(menu_catalog_item_id, menu_option_id, product_id, created_by, updated_by)
        select case when ${kind === "item"} then eligible.id else null end,
          case when ${kind === "option"} then eligible.id else null end, requested_products.id,
          ${session.id}::uuid, ${session.id}::uuid
        from eligible cross join requested_products on conflict do nothing returning id
      )
      select case
        when not exists(select 1 from target) then 'missing'
        when not exists(select 1 from target where canonical) then 'not_canonical'
        when not exists(select 1 from target where is_active) then 'inactive'
        when (select ids from current_links) <> ${expectedProductIds}::text[] then 'stale'
        when (select count(*) from requested_products) <> ${productIds.length} then 'invalid_products'
        else 'saved'
      end as status
    `
  ]);
  const status = String(results[1]?.[0]?.status ?? "");
  if (status === "missing") throw new MenuProductLinksError("対象メニューが見つかりません。", 404);
  if (status === "not_canonical") throw new MenuProductLinksError("共通メニューの商品・選択肢を選択してください。");
  if (status === "inactive") throw new MenuProductLinksError("停止中のメニューは関連付けを変更できません。", 409);
  if (status === "stale") throw new MenuProductLinksError("関連付けが更新されました。再読み込みして確認してください。", 409);
  if (status === "invalid_products") throw new MenuProductLinksError("ブランドに適用されない商品が含まれています。");
  if (status !== "saved") throw new MenuProductLinksError("関連付けを保存できませんでした。", 500);
  return readMenuProductLinks(kind, targetId);
}
