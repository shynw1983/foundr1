import { getSessionStoreScope } from "./api-auth";
import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import {
  canViewCatalogProduct,
  canViewCatalogProductAtStore,
  evaluateProductOrderability,
  isHeadquarterCatalogRole,
  normalizeCatalogVisibility,
  type CatalogPolicyProduct,
  type CatalogPolicyStore
} from "./product-catalog-policy";

export type ProductCatalogAccessResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

async function loadPolicyProducts(productIds?: string[]): Promise<CatalogPolicyProduct[]> {
  const rows = await sql`
    select
      products.id::text as id,
      coalesce(products.brand_scope, 'unset') as "brandScope",
      products.catalog_visibility as "catalogVisibility",
      products.is_orderable as "isOrderable",
      coalesce((
        select json_agg(json_build_object('brandId', usage.brand_id::text, 'isOrderable', usage.is_orderable))
        from product_brand_usages usage where usage.product_id = products.id
      ), '[]'::json) as "brandUsages",
      coalesce((
        select array_agg(grants.store_id::text)
        from product_catalog_store_grants grants where grants.product_id = products.id
      ), '{}'::text[]) as "catalogStoreIds"
    from products
    where (${productIds === undefined} or products.id::text = any(${productIds ?? []}))
  `;
  return rows.map((row) => ({
    id: String(row.id),
    brandScope: String(row.brandScope),
    catalogVisibility: normalizeCatalogVisibility(row.catalogVisibility),
    isOrderable: row.isOrderable === true,
    brandUsages: Array.isArray(row.brandUsages) ? row.brandUsages : [],
    catalogStoreIds: Array.isArray(row.catalogStoreIds) ? row.catalogStoreIds.map(String) : []
  }));
}

async function loadPolicyStores(storeIds: string[], allStores = false): Promise<CatalogPolicyStore[]> {
  const rows = await sql`
    select stores.id::text as id,
      coalesce(array_agg(store_brands.brand_id::text) filter (where store_brands.brand_id is not null), '{}'::text[]) as "brandIds"
    from stores
    left join store_brands on store_brands.store_id = stores.id
    where (${allStores} or stores.id::text = any(${storeIds}))
    group by stores.id
  `;
  return rows.map((row) => ({ id: String(row.id), brandIds: Array.isArray(row.brandIds) ? row.brandIds.map(String) : [] }));
}

export async function getProductCatalogAccessSnapshot(session: EmployeeSession, productIds?: string[]): Promise<{
  visibleProductIds: string[];
  orderableStoreIdsByProductId: Record<string, string[]>;
}> {
  const scope = await getSessionStoreScope(session);
  const [products, stores] = await Promise.all([
    loadPolicyProducts(productIds),
    loadPolicyStores(scope.storeIds, scope.allStores)
  ]);
  return {
    visibleProductIds: products.filter((product) => canViewCatalogProduct(product, session.role, stores)).map((product) => product.id),
    orderableStoreIdsByProductId: Object.fromEntries(products.map((product) => [
      product.id,
      stores.filter((store) => evaluateProductOrderability(product, store, session.role, true).allowed).map((store) => store.id)
    ]))
  };
}

export async function assertProductsOrderable(
  session: EmployeeSession,
  storeId: string,
  productIds: string[]
): Promise<ProductCatalogAccessResult> {
  const ids = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  if (!storeId || ids.length === 0) return { ok: false, status: 400, error: "店舗と商品を指定してください。" };
  const scope = await getSessionStoreScope(session);
  const hasStoreAccess = scope.allStores || scope.storeIds.includes(storeId);
  if (!hasStoreAccess) return { ok: false, status: 403, error: "この店舗を操作する権限がありません。" };
  const [products, stores] = await Promise.all([loadPolicyProducts(ids), loadPolicyStores([storeId])]);
  const store = stores[0];
  if (!store) return { ok: false, status: 404, error: "店舗が見つかりません。" };
  if (products.length !== ids.length) return { ok: false, status: 400, error: "商品マスタに存在しない商品があります。" };
  for (const product of products) {
    const decision = evaluateProductOrderability(product, store, session.role, hasStoreAccess);
    if (!decision.allowed) {
      return {
        ok: false,
        status: decision.reason === "not_orderable" ? 400 : 403,
        error: decision.reason === "not_orderable"
          ? "発注停止中の商品が含まれています。"
          : "この店舗では発注できない商品が含まれています。"
      };
    }
  }
  return { ok: true };
}

export async function assertProductViewable(session: EmployeeSession, productId: string): Promise<ProductCatalogAccessResult> {
  if (!productId) return { ok: false, status: 400, error: "商品を指定してください。" };
  const products = await loadPolicyProducts([productId]);
  const product = products[0];
  if (!product) return { ok: false, status: 404, error: "商品が見つかりません。" };
  if (isHeadquarterCatalogRole(session.role)) return { ok: true };
  const scope = await getSessionStoreScope(session);
  const stores = await loadPolicyStores(scope.storeIds);
  return canViewCatalogProduct(product, session.role, stores)
    ? { ok: true }
    : { ok: false, status: 403, error: "この商品を表示する権限がありません。" };
}

export async function assertProductViewableAtStore(
  session: EmployeeSession,
  storeId: string,
  productId: string
): Promise<ProductCatalogAccessResult> {
  if (!storeId || !productId) return { ok: false, status: 400, error: "店舗と商品を指定してください。" };
  const scope = await getSessionStoreScope(session);
  const hasStoreAccess = scope.allStores || scope.storeIds.includes(storeId);
  if (!hasStoreAccess) return { ok: false, status: 403, error: "この店舗を操作する権限がありません。" };
  const [products, stores] = await Promise.all([loadPolicyProducts([productId]), loadPolicyStores([storeId])]);
  if (!products[0] || !stores[0]) return { ok: false, status: 404, error: "店舗または商品が見つかりません。" };
  return canViewCatalogProductAtStore(products[0], stores[0], session.role, hasStoreAccess)
    ? { ok: true }
    : { ok: false, status: 403, error: "この店舗では商品を利用できません。" };
}

export async function getVisibleProductIdsForStore(session: EmployeeSession, storeId: string): Promise<string[]> {
  const scope = await getSessionStoreScope(session);
  const hasStoreAccess = scope.allStores || scope.storeIds.includes(storeId);
  if (!storeId || !hasStoreAccess) return [];
  const [products, stores] = await Promise.all([loadPolicyProducts(), loadPolicyStores([storeId])]);
  if (!stores[0]) return [];
  return products.filter((product) => canViewCatalogProductAtStore(product, stores[0], session.role, hasStoreAccess)).map((product) => product.id);
}
