type CatalogRecord = Record<string, unknown>;
export type CatalogAccessSnapshot = {
  visibleProductIds: string[];
  orderableStoreIdsByProductId: Record<string, string[]>;
};

const storeProductFields = [
  "id", "name", "productBrandName", "manufacturer", "category", "subcategory", "unit",
  "originCountries", "packageQuantity", "packageQuantityUnit", "productFamilyName", "variantName",
  "isDefaultVariant", "variantSortOrder", "specNote", "japaneseNote", "storageType", "usageType",
  "photoUrl", "brandScope", "brand", "isOrderable"
] as const;

/** Scope master data only. Existing store transactions retain their own recorded facts. */
export function scopeProcurementCatalogResponse<T extends {
  products?: CatalogRecord[];
  productBrandUsages?: CatalogRecord[];
  productSupplierOptions?: CatalogRecord[];
  suppliers?: CatalogRecord[];
  supplierLocations?: CatalogRecord[];
  priceSignals?: CatalogRecord[];
  purchaseOrderItems?: CatalogRecord[];
}>(data: T, access: CatalogAccessSnapshot, headquarters: boolean) {
  const visibleIds = new Set(access.visibleProductIds);
  const products = data.products?.filter((product) => visibleIds.has(String(product.id))).map((product) => {
    const orderableStoreIds = access.orderableStoreIdsByProductId[String(product.id)] ?? [];
    if (headquarters) return { ...product, procurementDetailsVisible: true, orderableStoreIds };
    return {
      ...Object.fromEntries(storeProductFields.filter((field) => field in product).map((field) => [field, product[field]])),
      referencePrice: null,
      procurementDetailsVisible: false,
      orderableStoreIds
    };
  });
  return {
    ...data,
    products,
    productBrandUsages: data.productBrandUsages?.filter((usage) => visibleIds.has(String(usage.productId))),
    productSupplierOptions: headquarters
      ? data.productSupplierOptions?.filter((option) => visibleIds.has(String(option.productId)))
      : data.productSupplierOptions === undefined ? undefined : [],
    suppliers: headquarters ? data.suppliers : data.suppliers === undefined ? undefined : [],
    supplierLocations: headquarters ? data.supplierLocations : data.supplierLocations === undefined ? undefined : [],
    priceSignals: headquarters ? data.priceSignals : [],
    purchaseOrderItems: headquarters ? data.purchaseOrderItems : data.purchaseOrderItems?.map((item) => ({
      ...item,
      referencePrice: null,
      priceExceptionNote: item.priceExceptionNote ? "価格について本部へ確認してください。" : ""
    })),
    procurementDetailsVisible: headquarters
  };
}
