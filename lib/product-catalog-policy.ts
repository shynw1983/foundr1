export const productCatalogVisibilities = ["internal", "brand_stores", "selected_stores"] as const;
export type ProductCatalogVisibility = typeof productCatalogVisibilities[number];

export type ProductCatalogConfiguration = {
  catalogVisibility: ProductCatalogVisibility;
  isOrderable: boolean;
  catalogStoreIds: string[];
};

export type CatalogPolicyProduct = ProductCatalogConfiguration & {
  id: string;
  brandScope: string;
  brandUsages: Array<{ brandId: string; isOrderable: boolean }>;
};

export type CatalogPolicyStore = { id: string; brandIds: string[] };
export type ProductOrderDecision =
  | { allowed: true }
  | { allowed: false; reason: "store_scope" | "brand_scope" | "unpublished" | "not_orderable" };

export function isHeadquarterCatalogRole(role: string) {
  return role === "owner" || role === "manager";
}

export function normalizeCatalogVisibility(value: unknown): ProductCatalogVisibility {
  return productCatalogVisibilities.includes(value as ProductCatalogVisibility)
    ? value as ProductCatalogVisibility
    : "internal";
}

/** Undefined fields preserve an existing policy for older product editors. */
export function resolveProductCatalogConfiguration(
  input: Partial<ProductCatalogConfiguration>,
  current?: ProductCatalogConfiguration
): ProductCatalogConfiguration {
  return {
    catalogVisibility: input.catalogVisibility === undefined
      ? current?.catalogVisibility ?? "internal"
      : normalizeCatalogVisibility(input.catalogVisibility),
    isOrderable: input.isOrderable === undefined ? current?.isOrderable ?? true : input.isOrderable === true,
    catalogStoreIds: Array.from(new Set(input.catalogStoreIds ?? current?.catalogStoreIds ?? []))
  };
}

export function productMatchesCatalogStore(product: CatalogPolicyProduct, store: CatalogPolicyStore) {
  return product.brandScope === "common" || (
    product.brandScope === "specific" && product.brandUsages.some((usage) => store.brandIds.includes(usage.brandId))
  );
}

export function isCatalogPublishedToStore(product: CatalogPolicyProduct, store: CatalogPolicyStore) {
  if (!productMatchesCatalogStore(product, store)) return false;
  return product.catalogVisibility === "brand_stores" || (
    product.catalogVisibility === "selected_stores" && product.catalogStoreIds.includes(store.id)
  );
}

export function canViewCatalogProduct(
  product: CatalogPolicyProduct,
  role: string,
  accessibleStores: CatalogPolicyStore[]
) {
  return isHeadquarterCatalogRole(role) || accessibleStores.some((store) => isCatalogPublishedToStore(product, store));
}

export function canViewCatalogProductAtStore(
  product: CatalogPolicyProduct,
  store: CatalogPolicyStore,
  role: string,
  hasStoreAccess: boolean
) {
  return hasStoreAccess && productMatchesCatalogStore(product, store) && (
    isHeadquarterCatalogRole(role) || isCatalogPublishedToStore(product, store)
  );
}

export function evaluateProductOrderability(
  product: CatalogPolicyProduct,
  store: CatalogPolicyStore,
  role: string,
  hasStoreAccess: boolean
): ProductOrderDecision {
  if (!hasStoreAccess) return { allowed: false, reason: "store_scope" };
  if (!productMatchesCatalogStore(product, store)) return { allowed: false, reason: "brand_scope" };
  if (!isHeadquarterCatalogRole(role) && !isCatalogPublishedToStore(product, store)) {
    return { allowed: false, reason: "unpublished" };
  }
  const matchingBrandUsages = product.brandUsages.filter((usage) => store.brandIds.includes(usage.brandId));
  const requiresOrderableBrandUsage = product.brandScope === "specific" || matchingBrandUsages.length > 0;
  if (!product.isOrderable || (requiresOrderableBrandUsage && !matchingBrandUsages.some((usage) => usage.isOrderable))) {
    return { allowed: false, reason: "not_orderable" };
  }
  return { allowed: true };
}

/** Convert only the product's explicit packaging relation; never infer units from a name. */
export function convertPurchaseQuantityToStockUnit(
  quantity: number,
  product: { unit: string; packageQuantity?: number | string | null; packageQuantityUnit?: string | null },
  stockUnit: string
) {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  if (product.unit === stockUnit) return quantity;
  const packageQuantity = Number(product.packageQuantity);
  if (product.packageQuantityUnit !== stockUnit || !Number.isFinite(packageQuantity) || packageQuantity <= 0) return null;
  return quantity * packageQuantity;
}
